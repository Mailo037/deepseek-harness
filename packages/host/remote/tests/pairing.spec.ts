import { describe, expect, it } from 'vitest'
import { PairingService, DEFAULT_PAIRING_TTL } from '../src/pairing.ts'

describe('PairingService', () => {
  function createService(overrides?: Partial<ConstructorParameters<typeof PairingService>[0]>): PairingService {
    return new PairingService({
      endpoints: [],
      pairingTtlSeconds: DEFAULT_PAIRING_TTL,
      accessToken: 'access-token-test',
      port: 3080,
      ...overrides,
    })
  }

  describe('create()', () => {
    it('returns a PairingView with token, expiresAt, JSON payload, and a QR data URL', async () => {
      const svc = createService()
      const view = await svc.create()
      expect(view.token).toBeTruthy()
      expect(view.expiresAt).toBeTruthy()
      expect(view.payload).toBeTruthy()
      expect(view.qrDataUrl).toMatch(/^data:image\/png;base64,/)
      const payload = JSON.parse(view.payload)
      expect(payload.v).toBe(1)
      expect(payload.token).toBe(view.token)
    })

    it('includes loopback as an endpoint', async () => {
      const svc = createService()
      const view = await svc.create()
      const payload = JSON.parse(view.payload) as { endpoints: string[] }
      expect(payload.endpoints).toContain('127.0.0.1:3080')
    })

    it('includes configured extra endpoints', async () => {
      const svc = createService({ endpoints: ['tailscale.example:3080'] })
      const view = await svc.create()
      const payload = JSON.parse(view.payload) as { endpoints: string[] }
      expect(payload.endpoints).toContain('tailscale.example:3080')
    })
  })

  describe('consume()', () => {
    it('returns the token on first consumption', async () => {
      const svc = createService()
      const { token } = await svc.create()
      expect(svc.consume(token)).toBe(token)
    })

    it('returns undefined on second consumption (one-time)', async () => {
      const svc = createService()
      const { token } = await svc.create()
      svc.consume(token)
      expect(svc.consume(token)).toBeUndefined()
    })

    it('returns undefined for an unknown token', () => {
      const svc = createService()
      expect(svc.consume('no-such-token')).toBeUndefined()
    })

    it('returns undefined for an expired token', async () => {
      const svc = createService({ pairingTtlSeconds: 0 }) // immediate expiry
      const { token } = await svc.create()
      // Wait a tick for the timer to pass
      await new Promise(resolve => setTimeout(resolve, 10))
      expect(svc.consume(token)).toBeUndefined()
    })
  })

  describe('endpoint auto-detection', () => {
    it('never duplicates entries', async () => {
      const svc = createService({ endpoints: ['127.0.0.1:3080'] })
      const view = await svc.create()
      const payload = JSON.parse(view.payload) as { endpoints: string[] }
      const unique = new Set(payload.endpoints)
      expect(unique.size).toBe(payload.endpoints.length)
    })
  })
})
