import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable identity of one paired remote device. */
export type RemoteDeviceId = Branded<'RemoteDeviceId'>

/** Server-issued secret a device presents on reconnect. Never stored in plaintext. */
export type RemoteDeviceSecret = Branded<'RemoteDeviceSecret'>

/** One pending pairing offer shown as a QR code on the host. */
export interface PairingView {
  /** One-time pairing token; consumed by the first device that presents it. */
  readonly token: string
  /** ISO timestamp after which the token is rejected. */
  readonly expiresAt: string
  /** The complete QR payload as JSON text. */
  readonly payload: string
  /** The QR code rendered server-side as a PNG data URL (browser-safe display). */
  readonly qrDataUrl: string
}

/**
 * QR payload a pairing code encodes. The device tries `endpoints` in order,
 * then connects to `<endpoint>/remote/device` and presents `token`. The
 * `accessToken` guards the GUI: every non-loopback browser request to the web
 * surface needs it (the app injects it into the GUI URL as `?dsh_token=`).
 */
export interface PairingPayload {
  /** Payload format version; currently 1. */
  readonly v: 1
  /** Authorities (`host` or `host:port`) the device should try, in order. */
  readonly endpoints: readonly string[]
  /** One-time pairing token. */
  readonly token: string
  /** Persistent GUI access token; empty when no token is configured. */
  readonly accessToken: string
}

/** Point-in-time GUI access token, returned to the settings surface. */
export interface AccessTokenView {
  readonly accessToken: string
}

/** One paired device as the settings UI and the wire expose it. */
export interface RemoteDeviceView {
  readonly deviceId: RemoteDeviceId
  /** Human-chosen or device-reported display name. */
  readonly name: string
  /** Device-reported platform label (e.g. `Android`). */
  readonly platform: string
  /** Whether the device currently holds a live channel socket. */
  readonly connected: boolean
  /** ISO timestamp of the last successful channel connection, or null. */
  readonly lastSeenAt: string | null
  /** ISO timestamp of the pairing. */
  readonly createdAt: string
}

/** Point-in-time device list returned by the remote face. */
export interface RemoteDevicesSnapshot {
  readonly devices: readonly RemoteDeviceView[]
}

/** Receipt of one revocation request. */
export interface RevokeReceipt {
  readonly deviceId: RemoteDeviceId
  /** False when the device was already absent. */
  readonly revoked: boolean
}

/** Payload a device sends as its first channel message to pair. */
export interface PairRequest {
  readonly type: 'pair'
  /** One-time pairing token from the QR payload. */
  readonly token: string
  readonly name: string
  readonly platform: string
}

/** Payload a paired device sends as its first channel message to reconnect. */
export interface AuthRequest {
  readonly type: 'auth'
  readonly secret: RemoteDeviceSecret
}

/** Payload the host sends in reply to a `pair` request. */
export interface PairedMessage {
  readonly type: 'paired'
  readonly deviceId: RemoteDeviceId
  readonly secret: RemoteDeviceSecret
  /** Persistent token for authenticated GUI HTTP and WebSocket requests. */
  readonly accessToken: string
}

/** Payload the host sends in reply to an `auth` request. */
export interface AuthedMessage {
  readonly type: 'authed'
  readonly deviceId: RemoteDeviceId
  /** Current persistent token for authenticated GUI HTTP and WebSocket requests. */
  readonly accessToken: string
}

/** Payload the host sends on a rejected first message. */
export interface RejectedMessage {
  readonly type: 'rejected'
  readonly reason: string
}

/** One attention notification pushed to a connected device. */
export interface RemoteNotification {
  readonly kind: 'turn-error' | 'turn-completed'
  /** The session the event belongs to. */
  readonly sessionId: string
  /** Human-readable summary (locale of the host). */
  readonly message: string
  /** ISO timestamp of the underlying session event. */
  readonly time: string
}

/** Server-to-device channel message. */
export interface NotificationFrame {
  readonly type: 'notification'
  readonly id: string
  readonly notification: RemoteNotification
}

/** Device-to-server channel message (first message only; the channel is otherwise downlink-only). */
export type DeviceHello = PairRequest | AuthRequest
