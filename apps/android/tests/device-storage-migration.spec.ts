import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, string>()

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: store.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => { store.set(key, value) },
    remove: async ({ key }: { key: string }) => { store.delete(key) },
  },
}))

const { loadConfig, persistLastSuccessful, persistAccessToken, saveConfig, guiUrlOf, clearConfig } = await import('../src/DeviceStorage.ts')

/** Seed a legacy pre-Tailscale config: only the single server URL, no endpoints key. */
function seedLegacy(): void {
  store.clear()
  store.set('serverUrl', 'http://192.168.1.5:3080')
  store.set('deviceId', 'device-1')
  store.set('deviceSecret', 'secret-1')
  store.set('deviceName', 'Pixel')
  store.set('accessToken', 'token-1')
}

beforeEach(() => {
  store.clear()
})

describe('loadConfig migration', () => {
  it('treats a legacy single-URL config as one endpoint and last-successful origin', async () => {
    seedLegacy()
    const config = await loadConfig()
    expect(config).not.toBeNull()
    expect(config?.endpoints).toEqual(['http://192.168.1.5:3080'])
    expect(config?.serverUrl).toBe('http://192.168.1.5:3080')
    // Identity survives the migration: no re-pairing is needed.
    expect(config?.deviceId).toBe('device-1')
    expect(config?.deviceSecret).toBe('secret-1')
    expect(config?.accessToken).toBe('token-1')
    expect(config?.deviceName).toBe('Pixel')
  })

  it('reads back a saved multi-endpoint config verbatim', async () => {
    seedLegacy()
    await saveConfig({
      endpoints: ['http://192.168.1.5:3080', 'http://mypc.tailnet.ts.net:3080'],
      serverUrl: 'http://mypc.tailnet.ts.net:3080',
      deviceId: 'device-1',
      deviceSecret: 'secret-1',
      deviceName: 'Pixel',
      accessToken: 'token-1',
    })
    const config = await loadConfig()
    expect(config?.endpoints).toEqual(['http://192.168.1.5:3080', 'http://mypc.tailnet.ts.net:3080'])
    expect(config?.serverUrl).toBe('http://mypc.tailnet.ts.net:3080')
  })

  it('returns null when the pairing identity is missing', async () => {
    expect(await loadConfig()).toBeNull()
  })

  it('ignores a corrupted endpoints value', async () => {
    seedLegacy()
    store.set('endpoints', '{not json')
    const config = await loadConfig()
    expect(config?.endpoints).toEqual(['http://192.168.1.5:3080'])
  })

  it('drops non-string entries from a stored endpoints value', async () => {
    seedLegacy()
    store.set('endpoints', JSON.stringify(['http://192.168.1.5:3080', 42, null]))
    const config = await loadConfig()
    expect(config?.endpoints).toEqual(['http://192.168.1.5:3080'])
  })
})

describe('persistLastSuccessful', () => {
  it('moves the successful origin to serverUrl and appends it when unknown', async () => {
    seedLegacy()
    await persistLastSuccessful('http://mypc.tailnet.ts.net:3080')
    const config = await loadConfig()
    expect(config?.serverUrl).toBe('http://mypc.tailnet.ts.net:3080')
    expect(config?.endpoints).toEqual([
      'http://192.168.1.5:3080',
      'http://mypc.tailnet.ts.net:3080',
    ])
  })

  it('does not duplicate an origin that is already in the list', async () => {
    seedLegacy()
    await persistLastSuccessful('http://192.168.1.5:3080')
    await persistLastSuccessful('http://192.168.1.5:3080')
    const config = await loadConfig()
    expect(config?.endpoints).toEqual(['http://192.168.1.5:3080'])
  })

  it('is a no-op without a stored config', async () => {
    await expect(persistLastSuccessful('http://192.168.1.5:3080')).resolves.toBeUndefined()
    expect(await loadConfig()).toBeNull()
  })
})

describe('guiUrlOf', () => {
  it('appends the token to the requested origin', () => {
    const config = {
      endpoints: [],
      serverUrl: 'http://192.168.1.5:3080',
      deviceId: 'd',
      deviceSecret: 's',
      deviceName: 'n',
      accessToken: 'tok en',
    }
    expect(guiUrlOf(config, 'http://mypc.tailnet.ts.net:3080'))
      .toBe('http://mypc.tailnet.ts.net:3080/?dsh_token=tok%20en')
    expect(guiUrlOf(config)).toBe('http://192.168.1.5:3080/?dsh_token=tok%20en')
  })

  it('returns the bare origin without an access token', () => {
    const config = {
      endpoints: [],
      serverUrl: 'http://192.168.1.5:3080',
      deviceId: 'd',
      deviceSecret: 's',
      deviceName: 'n',
      accessToken: '',
    }
    expect(guiUrlOf(config)).toBe('http://192.168.1.5:3080')
  })
})

describe('persistAccessToken', () => {
  it('updates only the GUI token so an authenticated channel can repair a stale iframe', async () => {
    seedLegacy()
    await persistAccessToken('refreshed-token')
    expect((await loadConfig())?.accessToken).toBe('refreshed-token')
    expect((await loadConfig())?.serverUrl).toBe('http://192.168.1.5:3080')
  })
})

describe('clearConfig', () => {
  it('removes the endpoints key too', async () => {
    seedLegacy()
    expect(await loadConfig()).not.toBeNull()
    await clearConfig()
    expect(await loadConfig()).toBeNull()
    expect(store.has('endpoints')).toBe(false)
  })
})
