import { randomBytes } from 'node:crypto'
import { networkInterfaces } from 'node:os'
import { z } from 'zod'
import { toDataURL as renderQrDataUrl } from 'qrcode'
import type { PairingPayload, PairingView } from './types.ts'

/** Plugin config for pairing behaviour. */
export interface PairingConfig {
  /**
   * Extra authorities appended to the auto-detected LAN endpoints. A scheme
   * prefix (`https://`) is carried into the payload so the device picks TLS.
   */
  readonly endpoints: readonly string[]
  /** Pairing token lifetime in seconds. */
  readonly pairingTtlSeconds: number
  /** The webserver listen port (injected at service activation). */
  readonly port: number
  /**
   * Whether the webserver binds all interfaces. LAN endpoints only make sense
   * then because loopback-only binds are unreachable from other devices.
   */
  readonly allInterfaces?: boolean
  /** The GUI access token; carried into the QR payload so the device can build the authenticated GUI URL. */
  readonly accessToken: string
}

/** One pending, unexpired pairing token. */
interface PendingToken {
  readonly token: string
  readonly expiresAt: number
  consumed: boolean
}

/** Default pairing TTL (seconds). */
export const DEFAULT_PAIRING_TTL = 300

/** Zod schema for the pairing config subset. */
export const pairingConfigSchema = z.object({
  endpoints: z.array(z.string()).default([]),
  pairingTtlSeconds: z.number().int().min(10).max(86400).default(DEFAULT_PAIRING_TTL),
})

/** Maximum number of concurrent pending tokens. Older tokens are evicted on create. */
const MAX_PENDING_TOKENS = 5

/**
 * In-memory pairing service. Generates one-time tokens, validates them, and
 * builds the QR payload with auto-detected LAN endpoints.
 */
export class PairingService {
  private readonly pending = new Map<string, PendingToken>()

  constructor(private readonly config: PairingConfig) {}

  /** Persistent token the paired device uses for authenticated GUI requests. */
  get guiAccessToken(): string {
    return this.config.accessToken
  }

  /**
   * Create a new pairing token and return the full pairing view (QR payload
   * and the server-rendered QR data URL). Oldest pending tokens are evicted
   * when the pending count exceeds the limit.
   * @returns Fresh one-time pairing view.
   */
  async create(): Promise<PairingView> {
    this.evictExpired()
    const token = randomBytes(16).toString('hex')
    const expiresAt = Date.now() + this.config.pairingTtlSeconds * 1000
    this.pending.set(token, { token, expiresAt, consumed: false })
    if (this.pending.size > MAX_PENDING_TOKENS) {
      const oldest = this.pending.keys().next().value
      if (oldest !== undefined) this.pending.delete(oldest)
    }
    const payload: PairingPayload = {
      v: 1,
      endpoints: this.buildEndpoints(),
      token,
      accessToken: this.config.accessToken,
    }
    const payloadJson = JSON.stringify(payload)
    const qrDataUrl = await renderQrDataUrl(payloadJson, { margin: 1, width: 360 })
    return {
      token,
      expiresAt: new Date(expiresAt).toISOString(),
      payload: payloadJson,
      qrDataUrl,
    }
  }

  /**
   * Validate and consume a pairing token. Returns the token string on success,
   * or undefined if the token is unknown, expired, or already consumed.
   * @param token - One-time pairing token.
   * @returns The consumed token on success.
   */
  consume(token: string): string | undefined {
    this.evictExpired()
    const entry = this.pending.get(token)
    if (entry === undefined) return undefined
    if (entry.consumed) return undefined
    if (entry.expiresAt <= Date.now()) {
      this.pending.delete(token)
      return undefined
    }
    entry.consumed = true
    return token
  }

  /** Remove expired tokens from the pending map. */
  private evictExpired(): void {
    const now = Date.now()
    for (const [key, entry] of this.pending) {
      if (entry.expiresAt <= now) this.pending.delete(key)
    }
  }

  /**
   * Build the endpoint list the QR payload carries. LAN IPs are only
   * advertised when the webserver binds all interfaces — a loopback-only bind
   * is unreachable from other devices, and advertising those addresses would
   * make every pairing attempt fail on the device. Configured extras (tunnel
   * or Tailscale addresses, optionally with an `https://` scheme) always come
   * after the auto-detected entries, and loopback closes the list.
   */
  private buildEndpoints(): string[] {
    const endpoints: string[] = []
    const port = this.config.port
    if (this.config.allInterfaces === true) {
      for (const ifaces of Object.values(networkInterfaces())) {
        if (ifaces === undefined) continue
        for (const iface of ifaces) {
          if (iface.internal || iface.family !== 'IPv4') continue
          endpoints.push(`${iface.address}:${port}`)
        }
      }
    }
    for (const ep of this.config.endpoints) {
      if (!endpoints.includes(ep)) endpoints.push(ep)
    }
    const loopback = `127.0.0.1:${port}`
    if (!endpoints.includes(loopback)) endpoints.push(loopback)
    return endpoints
  }
}
