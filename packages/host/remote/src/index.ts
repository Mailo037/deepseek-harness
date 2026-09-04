/**
 * @deepseek-ai/dsh-host-remote — remote device plane for the Harness Web GUI.
 * Pairs Android (or any) devices via one-time QR codes, keeps a durable device
 * registry, pushes session attention events to connected devices over a
 * WebSocket channel, and enforces instant server-side revocation.
 *
 * The browser surface reads and drives this plane through the `device` Remote
 * namespace (`ctx.remote.device.*`); the Android app (not yet shipped) speaks
 * the device channel protocol directly.
 * @module @deepseek-ai/dsh-host-remote
 */

import { randomBytes } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { Service, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-storage-domain'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Waterfall: whether a browser request to the web surface is authorized.
     * @mode waterfall
     * @param request - HTTP request whose origin and presented token are checked.
     * @param next - Delegate to the next authentication listener.
     */
    'connection/authenticate'(this: Context, request: IncomingMessage, next: () => boolean): boolean
  }
}
import { NotificationBridge } from './bridge.ts'
import { DeviceChannel } from './device-channel.ts'
import { PairingService } from './pairing.ts'
import { DeviceRegistry, REMOTE_DEVICES_DOMAIN } from './registry.ts'
import type {
  AccessTokenView, PairingView, RemoteDeviceId, RemoteDevicesSnapshot, RevokeReceipt,
} from './types.ts'
import { isAuthorizedRequest, ACCESS_COOKIE_SCRIPT } from './auth.ts'
import { toString as renderQrTerminal } from 'qrcode'

/** Stable Cordis plugin name. */
export const name = 'host-remote'

/** The WebSocket upgrade path of the device channel. */
export const DEVICE_PATH = '/remote/device'

/** The standalone pairing page path. */
export const REMOTE_PAGE_PATH = '/remote'

/** Remote namespace served to the browser. */
export const NAMESPACE = 'device' as const

/** Plugin config: pairing, notification, and channel choices. */
export interface RemoteConfig {
  /** Extra authorities appended to auto-detected LAN endpoints in the QR payload. */
  readonly endpoints: string[]
  /** Pairing token lifetime in seconds. */
  readonly pairingTtlSeconds: number
  /** Notify connected devices when a turn ends with an error. */
  readonly notifyOnError: boolean
  /** Notify connected devices when a turn completes. */
  readonly notifyOnCompleted: boolean
  /** Notify connected devices when a session needs user attention. */
  readonly notifyOnAttention: boolean
  /** Print a pairing QR code to stdout after activation. */
  readonly printPairingQr: boolean
}

export const Config: z<RemoteConfig> = z.object({
  endpoints: z.array(String).default([]),
  pairingTtlSeconds: z.natural().min(10).max(86400).default(300),
  notifyOnError: z.boolean().default(true),
  notifyOnCompleted: z.boolean().default(true),
  notifyOnAttention: z.boolean().default(true),
  printPairingQr: z.boolean().default(false),
})

/**
 * The remote device plane: pairing offers, durable device registry, the
 * WebSocket device channel, and the session-event notification bridge.
 */
export class RemoteGateway extends TypertRemoteService {
  static inject = ['webServer', 'storageDomain']

  private registry!: DeviceRegistry
  private channel!: DeviceChannel
  private pairing!: PairingService
  private bridge!: NotificationBridge
  private accessToken!: string

  constructor(ctx: Context, private config: RemoteConfig) {
    super(ctx, 'device')
  }

  /** Open the registry domain and mount the channel, bridge, pairing service, and GUI auth. */
  async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(REMOTE_DEVICES_DOMAIN)
    this.ctx.effect(() => () => { void domain.close() }, 'host-remote: devices domain')

    this.registry = new DeviceRegistry(domain)
    this.accessToken = this.registry.getAccessToken()
    if (this.accessToken.length === 0) {
      this.accessToken = randomBytes(32).toString('hex')
      await this.registry.setAccessToken(this.accessToken)
    }

    this.pairing = new PairingService({
      endpoints: this.config.endpoints,
      pairingTtlSeconds: this.config.pairingTtlSeconds,
      port: this.ctx.webServer.port,
      allInterfaces: this.ctx.webServer.host === '0.0.0.0',
      accessToken: this.accessToken,
    })
    this.channel = new DeviceChannel(this.registry, this.pairing)

    const route: import('@deepseek-ai/dsh-host-webserver').WebUpgradeRoute = {
      path: DEVICE_PATH,
      handler: (req, socket, head) => { this.channel.handleUpgrade(req, socket, head) },
    }
    this.ctx.effect(() => this.ctx.webServer.registerUpgrade(route), 'host-remote: device channel route')
    this.ctx.effect(() => () => { this.channel.close() }, 'host-remote: device channel')

    // GUI auth: the connection plugin's waterfall seam lets every non-loopback
    // /api request and WebSocket downlink pass only with the access token.
    this.ctx.effect(() => this.ctx.on('connection/authenticate', (request, next) => {
      return isAuthorizedRequest(request, this.accessToken) ? next() : false
    }), 'host-remote: gui access-token guard')

    // Inject request auth into every index.html render. Connection fetches and
    // WebSockets carry the query token explicitly; the cookie remains a
    // same-origin browser fallback.
    this.ctx.effect(() => this.ctx.webServer.tapIndex(html => html.includes(ACCESS_COOKIE_SCRIPT) ? html : html.replace('</head>', `${ACCESS_COOKIE_SCRIPT}</head>`)), 'host-remote: access-token index script')

    // Standalone pairing page: a fresh one-time code rendered server-side, so
    // the QR is scannable without the full GUI (Settings > Remote stays the
    // interactive surface). Each GET mints a new code and retires the previous
    // one; tokens are ephemeral and bounded by the pairing service.
    const pairingPage: import('@deepseek-ai/dsh-host-webserver').WebRoute = {
      kind: 'exact',
      path: REMOTE_PAGE_PATH,
      handler: async (_req, res) => {
        const view = await this.pairing.create()
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(pairingPageHtml(view.qrDataUrl, view))
      },
    }
    this.ctx.effect(() => this.ctx.webServer.register(pairingPage), 'host-remote: pairing page')

    this.bridge = new NotificationBridge(this.ctx, {
      notifyOnError: this.config.notifyOnError,
      notifyOnCompleted: this.config.notifyOnCompleted,
      notifyOnAttention: this.config.notifyOnAttention,
    }, this.channel)
    this.ctx.effect(() => () => { this.bridge.close() }, 'host-remote: notification bridge')

    if (this.config.printPairingQr) {
      const view = await this.pairing.create()
      const qr = await renderQrTerminal(view.payload, { type: 'terminal', small: true })
      console.log('dsh remote: pairing QR (one-time, expires ' + view.expiresAt + ')')
      console.log(qr)
      console.log('dsh remote: open the Web GUI to see this code in Settings > Remote')
    }
  }

  /**
   * Read the persistent GUI access token (for the settings surface).
   * @returns Current access token.
   */
  @Remote('accessTokenGet')
  accessTokenGet(): AccessTokenView {
    return { accessToken: this.accessToken }
  }

  /**
   * Create a fresh one-time pairing code (QR payload and data URL included).
   * @returns Fresh pairing view.
   */
  @Remote('pairingCreate')
  async pairingCreate(): Promise<PairingView> {
    return this.pairing.create()
  }

  /**
   * List every paired device with its live connection status.
   * @returns Current remote-device snapshot.
   */
  @Remote('devicesList')
  devicesList(): RemoteDevicesSnapshot {
    return this.registry.snapshot(id => this.channel.isConnected(id))
  }

  /**
   * Revoke a device: remove its record AND terminate its live connection.
   * The device cannot reconnect (its secret is gone) and must pair again.
   * @param request - Device revocation request.
   * @returns Revocation receipt.
   */
  @Remote('devicesRevoke')
  async devicesRevoke(request: { deviceId: RemoteDeviceId }): Promise<RevokeReceipt> {
    this.channel.revoke(request.deviceId)
    const revoked = await this.registry.remove(request.deviceId)
    return { deviceId: request.deviceId, revoked }
  }
}

export default RemoteGateway

/** Minimal standalone HTML page showing a fresh pairing QR code and payload. */
function pairingPageHtml(qr: string, view: PairingView): string {
  return `<!DOCTYPE html>
<html lang="zh-Hans">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>远程设备配对</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;flex-direction:column;align-items:center;padding:40px 20px;gap:20px;color:#222}
h1{font-size:20px;font-weight:600;margin:0}
.hint{font-size:14px;color:#666;text-align:center;max-width:360px}
.qr{width:260px;height:260px;border:1px solid #ddd;border-radius:10px;background:#fff;padding:8px}
.payload{font-family:monospace;font-size:11px;color:#999;max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.expires{font-size:13px;color:#999}
</style>
</head>
<body>
<h1>远程设备配对</h1>
<p class="hint">在手机 App 中扫描此二维码即可连接此电脑。<br>配对码仅限一次使用，并会在几分钟后过期。</p>
${qr ? `<img class="qr" src="${qr}" alt="配对二维码">` : '<p class="hint">二维码生成失败</p>'}
<p class="expires">过期时间：${new Date(view.expiresAt).toLocaleString()}</p>
<p class="payload" title="${view.payload}">${view.payload}</p>
</body>
</html>`
}
