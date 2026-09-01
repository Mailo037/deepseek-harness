import { createHash, randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocket, WebSocketServer } from 'ws'
import type {
  AuthRequest, AuthedMessage, DeviceHello, NotificationFrame, PairedMessage,
  PairRequest, RejectedMessage, RemoteDeviceId, RemoteDeviceSecret,
  RemoteNotification,
} from './types.ts'
import { DeviceRegistry, type StoredDevice } from './registry.ts'
import type { PairingService } from './pairing.ts'

/** Convert a WebSocket Data message to a UTF-8 string. */
function dataToString(data: WebSocket.Data): string {
  if (typeof data === 'string') return data
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8')
  return data.toString('utf8')
}

/**
 * SHA-256 hex digest of a device secret (the only form ever persisted).
 * @param secret - Plaintext device secret.
 * @returns Lowercase SHA-256 digest.
 */
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

/**
 * Owns the WebSocket device channel: accepts pairing and auth connections,
 * delivers notifications to connected devices, and enforces revocation. The
 * owning plugin registers the upgrade route on the web server; this class
 * only negotiates and pumps sockets.
 */
export class DeviceChannel {
  private readonly server = new WebSocketServer({ noServer: true })
  /** Live socket indexed by device id. */
  private readonly sockets = new Map<RemoteDeviceId, WebSocket>()

  constructor(
    private readonly registry: DeviceRegistry,
    private readonly pairing: PairingService,
  ) {}

  /**
   * Handle one HTTP upgrade request (the webServer upgrade route handler).
   * The first message must be `pair` (new device) or `auth` (reconnect).
   * @param req - HTTP upgrade request.
   * @param socket - Raw socket transferred by the HTTP server.
   * @param head - Bytes already read after the upgrade headers.
   */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    this.server.handleUpgrade(req, socket, head, (ws) => {
      let deviceId: RemoteDeviceId | undefined
      const forget = (): void => {
        if (deviceId !== undefined) this.sockets.delete(deviceId)
      }
      ws.once('close', forget)
      ws.once('error', forget)
      ws.once('message', (raw) => {
        // The wire is untrusted: the first message must be `pair` or `auth`.
        let hello: DeviceHello | { readonly type: string }
        try {
          hello = JSON.parse(dataToString(raw)) as DeviceHello | { readonly type: string }
        } catch {
          this.send(ws, { type: 'rejected', reason: 'invalid json' } satisfies RejectedMessage)
          ws.close(1008, 'invalid json')
          return
        }
        if (hello.type === 'pair' && 'token' in hello) {
          void this.pair(ws, hello).then((id) => { deviceId = id })
        } else if (hello.type === 'auth' && 'secret' in hello) {
          void this.auth(ws, hello).then((id) => { deviceId = id })
        } else {
          this.send(ws, { type: 'rejected', reason: 'first message must be pair or auth' } satisfies RejectedMessage)
          ws.close(1008, 'unexpected hello')
        }
      })
    })
  }

  /**
   * Pair a new device: consume the one-time token, persist the device record,
   * and hand the device its secret.
   */
  private async pair(ws: WebSocket, msg: PairRequest): Promise<RemoteDeviceId | undefined> {
    if (this.pairing.consume(msg.token) === undefined) {
      this.reject(ws, 'invalid or expired token')
      return undefined
    }
    const deviceId = randomUUID() as RemoteDeviceId
    const secret = randomUUID() as RemoteDeviceSecret
    const now = new Date().toISOString()
    const record: StoredDevice = {
      name: msg.name,
      platform: msg.platform,
      secretHash: hashSecret(secret),
      createdAt: now,
      lastSeenAt: now,
    }
    try {
      await this.registry.create(deviceId, record)
    } catch {
      this.reject(ws, 'failed to persist device')
      return undefined
    }
    this.attach(deviceId, ws)
    this.send(ws, {
      type: 'paired',
      deviceId,
      secret,
      accessToken: this.pairing.guiAccessToken,
    } satisfies PairedMessage)
    return deviceId
  }

  /** Reconnect a paired device by presenting its secret. */
  private async auth(ws: WebSocket, msg: AuthRequest): Promise<RemoteDeviceId | undefined> {
    const found = this.registry.findBySecretHash(hashSecret(msg.secret))
    if (found === undefined) {
      this.reject(ws, 'unknown secret')
      return undefined
    }
    const [deviceId] = found
    const now = new Date().toISOString()
    try {
      await this.registry.touch(deviceId, now)
    } catch {
      // Non-fatal: the connection stands even when the timestamp write fails.
    }
    this.attach(deviceId, ws)
    this.send(ws, {
      type: 'authed',
      deviceId,
      accessToken: this.pairing.guiAccessToken,
    } satisfies AuthedMessage)
    return deviceId
  }

  /** Replace any older socket of the device and register the new one. */
  private attach(deviceId: RemoteDeviceId, ws: WebSocket): void {
    const old = this.sockets.get(deviceId)
    if (old !== undefined && old.readyState === WebSocket.OPEN) {
      old.close(1000, 'replaced by a new connection')
    }
    this.sockets.set(deviceId, ws)
  }

  /**
   * Deliver one notification to a connected device.
   * @param deviceId - Destination device.
   * @param notification - Notification payload.
   */
  notify(deviceId: RemoteDeviceId, notification: RemoteNotification): void {
    const ws = this.sockets.get(deviceId)
    if (ws === undefined || ws.readyState !== WebSocket.OPEN) return
    this.send(ws, {
      type: 'notification',
      id: randomUUID(),
      notification,
    } satisfies NotificationFrame)
  }

  /**
   * Deliver one notification to every connected device.
   * @param notification - Notification payload.
   */
  broadcast(notification: RemoteNotification): void {
    for (const deviceId of this.sockets.keys()) this.notify(deviceId, notification)
  }

  /**
   * Immediately terminate a device's connection; the device cannot reconnect while this socket is gone.
   * @param deviceId - Device to disconnect.
   */
  revoke(deviceId: RemoteDeviceId): void {
    const ws = this.sockets.get(deviceId)
    if (ws === undefined) return
    ws.terminate()
    this.sockets.delete(deviceId)
  }

  /**
   * Whether the device currently holds a live socket.
   * @param deviceId - Device to inspect.
   * @returns Whether its socket is open.
   */
  isConnected(deviceId: RemoteDeviceId): boolean {
    const ws = this.sockets.get(deviceId)
    return ws !== undefined && ws.readyState === WebSocket.OPEN
  }

  /** Terminate every socket and release the acceptor. */
  close(): void {
    for (const ws of this.sockets.values()) ws.terminate()
    this.sockets.clear()
  }

  private reject(ws: WebSocket, reason: string): void {
    this.send(ws, { type: 'rejected', reason } satisfies RejectedMessage)
    ws.close(1008, reason)
  }

  private send(ws: WebSocket, data: unknown): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data))
  }
}
