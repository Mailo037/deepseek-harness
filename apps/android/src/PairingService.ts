/**
 * In-app pairing: connects to one of the endpoint candidates, sends the
 * one-time token, and receives the device secret. The foreground service
 * later uses the secret for the persistent notification channel.
 */

import { endpointsOf } from './EndpointSelection.ts'
import { channelUrlOf, parsePairingPayload, type PairedMessage, type RejectedMessage } from './PairingProtocol.ts'

/**
 * Progress of a pairing attempt, reported to the connecting UI so it can
 * show concrete steps instead of a static "Connecting…" text.
 */
export type PairingStage =
  | { kind: 'finding'; serverUrl: string }
  | { kind: 'handshake'; serverUrl: string }
  | { kind: 'setup' }

/** Callback receiving each pairing progress transition. */
export type PairingStageListener = (stage: PairingStage) => void

/** Result of a successful pairing attempt. */
export interface PairingResult {
  /** The origin the successful pair went through. */
  serverUrl: string
  /** All usable origins (QR list with loopback aliases dropped; LAN first, then Tailscale/extras). */
  endpoints: string[]
  deviceId: string
  secret: string
  deviceName: string
  /** Persistent GUI access token returned by the paired host. */
  accessToken: string
}

/**
 * Try to pair with the PC by trying each endpoint from the QR payload in
 * order. The first successful pair resolves; all failures are reported.
 * Progress transitions (endpoint attempts, handshake) go to `onStage`.
 */
export async function pairWithQrData(
  rawPayload: string,
  deviceName: string,
  signal?: AbortSignal,
  onStage?: PairingStageListener,
): Promise<PairingResult> {
  const payload = parsePairingPayload(rawPayload)
  if (payload === null) throw new Error('Invalid QR payload format')
  if (payload.endpoints.length === 0) {
    throw new Error('The QR code lists no server addresses — regenerate the pairing code on the PC.')
  }

  // Build server URLs from the endpoints (a scheme prefix on an endpoint is
  // kept so tunnel entries can request TLS).
  const serverUrls = payload.endpoints.map((ep) => {
    const protocol = ep.includes('://') ? '' : 'http://'
    return `${protocol}${ep}`
  })
  const result = await pairWithEndpoints(payload.token, serverUrls, deviceName, signal, onStage)
  return { ...result, endpoints: endpointsOf(payload.endpoints) }
}

/**
 * Try to pair with the PC using a known server URL and a token from the
 * Settings → Remote page. The successful host reply also carries the
 * persistent GUI access token, so manual pairing authenticates the iframe in
 * exactly the same way as QR pairing.
 * Progress transitions go to `onStage`.
 */
export async function pairWithToken(
  serverUrl: string,
  token: string,
  deviceName: string,
  signal?: AbortSignal,
  onStage?: PairingStageListener,
): Promise<PairingResult> {
  const result = await pairWithEndpoints(token, [serverUrl], deviceName, signal, onStage)
  return { ...result, endpoints: [serverUrl] }
}

async function pairWithEndpoints(
  token: string,
  serverUrls: string[],
  deviceName: string,
  signal?: AbortSignal,
  onStage?: PairingStageListener,
): Promise<Omit<PairingResult, 'endpoints'>> {
  const errors: string[] = []
  const platform = 'Android'

  for (const serverUrl of serverUrls) {
    if (signal?.aborted === true) throw new Error('Cancelled')
    onStage?.({ kind: 'finding', serverUrl })
    try {
      const wsUrl = channelUrlOf(serverUrl)
      const result = await pairOverWs(wsUrl, token, deviceName, platform, signal, onStage, serverUrl)
      return { serverUrl, ...result, deviceName }
    } catch (error) {
      errors.push(`${serverUrl}: ${String(error instanceof Error ? error.message : error)}`)
    }
  }
  throw new Error(`All endpoints failed: ${errors.join('; ')}`)
}

function pairOverWs(
  wsUrl: string,
  token: string,
  name: string,
  platform: string,
  signal?: AbortSignal,
  onStage?: PairingStageListener,
  serverUrl?: string,
): Promise<{ deviceId: string; secret: string; accessToken: string }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    // Abort unwinds the attempt itself: close alone would produce a clean
    // close event (wasClean) that no handler rejects, leaving the caller
    // hanging until the timeout.
    const cleanup = (): void => {
      ws.close()
      reject(new Error('Cancelled'))
    }
    signal?.addEventListener('abort', cleanup, { once: true })

    const timeout = setTimeout(() => {
      ws.close()
      reject(new Error('Connection timed out'))
    }, 10_000)

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'pair', token, name, platform }))
      if (serverUrl !== undefined) onStage?.({ kind: 'handshake', serverUrl })
    }

    ws.onmessage = (event) => {
      let msg: unknown
      try {
        msg = JSON.parse(event.data as string)
      } catch {
        return
      }
      const parsed = msg as Partial<PairedMessage | RejectedMessage>
      if (parsed.type === 'paired') {
        const paired = parsed
        // Wire-boundary check: a malformed paired frame is ignored like any
        // other non-pairing message instead of persisting undefined secrets.
        if (
          typeof paired.deviceId !== 'string' || paired.deviceId.length === 0 ||
          typeof paired.secret !== 'string' || paired.secret.length === 0 ||
          typeof paired.accessToken !== 'string'
        ) {
          return
        }
        clearTimeout(timeout)
        ws.close()
        resolve({
          deviceId: paired.deviceId,
          secret: paired.secret,
          accessToken: paired.accessToken,
        })
      } else if (parsed.type === 'rejected') {
        clearTimeout(timeout)
        ws.close()
        reject(new Error(`Server rejected: ${(parsed as RejectedMessage).reason}`))
      }
      // Ignore other message types during pairing.
    }

    ws.onerror = () => {
      clearTimeout(timeout)
      reject(new Error('WebSocket connection failed'))
    }

    ws.onclose = (event) => {
      clearTimeout(timeout)
      if (!event.wasClean) reject(new Error('Connection closed unexpectedly'))
    }
  })
}
