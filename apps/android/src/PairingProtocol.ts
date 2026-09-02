/**
 * Wire protocol shared with the host `@deepseek-ai/dsh-host-remote` package.
 * These types mirror the host's `src/types.ts`; keep both sides in sync.
 * This file is intentionally self-contained (no imports) so the app can use
 * it without pulling the harness packages into the APK.
 */

/** The QR payload a pairing code encodes (`dsh-remote://` payload, JSON `v: 1`). */
export interface PairingPayload {
  v: 1
  /** Authorities (`host` or `host:port`) the device should try, in order. */
  endpoints: readonly string[]
  /** One-time pairing token. */
  token: string
  /** Persistent GUI access token; empty when the host configured none. */
  accessToken: string
}

/** First channel message: pair a new device with a one-time token. */
export interface PairRequest {
  type: 'pair'
  token: string
  name: string
  platform: string
}

/** First channel message: reconnect a paired device with its secret. */
export interface AuthRequest {
  type: 'auth'
  secret: string
}

/** Host reply to a successful `pair`. */
export interface PairedMessage {
  type: 'paired'
  deviceId: string
  secret: string
  /** Persistent token for authenticated GUI HTTP and WebSocket requests. */
  accessToken: string
}

/** Host reply to a successful `auth`. */
export interface AuthedMessage {
  type: 'authed'
  deviceId: string
  /** Current persistent token for authenticated GUI HTTP and WebSocket requests. */
  accessToken: string
}

/** Host reply to a rejected first message. */
export interface RejectedMessage {
  type: 'rejected'
  reason: string
}

/** One attention notification pushed by the host. */
export interface RemoteNotification {
  kind: 'turn-error' | 'turn-completed'
  sessionId: string
  /** Host-rendered status text, identified by session title when available. */
  message: string
  time: string
}

/** Server-to-device channel message. */
export interface NotificationFrame {
  type: 'notification'
  id: string
  notification: RemoteNotification
}

/** Any message the host may send on the channel. */
export type ChannelMessage = PairedMessage | AuthedMessage | RejectedMessage | NotificationFrame

/** Parse the JSON payload a QR code carries into a pairing payload. */
export function parsePairingPayload(raw: string): PairingPayload | null {
  try {
    const value = JSON.parse(raw) as unknown
    if (typeof value !== 'object' || value === null) return null
    const payload = value as Partial<PairingPayload>
    if (payload.v !== 1 || typeof payload.token !== 'string' || payload.token.length === 0) {
      return null
    }
    if (!Array.isArray(payload.endpoints) || payload.endpoints.some(e => typeof e !== 'string')) {
      return null
    }
    if (typeof payload.accessToken !== 'string') {
      return null
    }
    return payload as PairingPayload
  } catch {
    return null
  }
}

/** Build the channel WebSocket URL for one endpoint (`ws(s)://host:port/remote/device`). */
export function channelUrlOf(serverUrl: string): string {
  const wsProtocol = serverUrl.startsWith('https:') ? 'wss:' : 'ws:'
  const hostPort = serverUrl.replace(/^[a-z]+:\/\//i, '')
  return `${wsProtocol}//${hostPort}/remote/device`
}
