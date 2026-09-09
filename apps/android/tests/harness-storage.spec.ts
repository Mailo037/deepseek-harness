import { beforeEach, expect, it, vi } from 'vitest'
const store = new Map<string, string>()
vi.mock('@capacitor/preferences', () => ({ Preferences: {
  get: async ({ key }: { key: string }) => ({ value: store.get(key) ?? null }),
  set: async ({ key, value }: { key: string; value: string }) => { store.set(key, value) },
  remove: async ({ key }: { key: string }) => { store.delete(key) },
} }))
const storage = await import('../src/HarnessStorage.ts')
const { saveConfig } = await import('../src/DeviceStorage.ts')
const config = (host: string) => ({ serverUrl: `http://${host}`, endpoints: [`http://${host}`], deviceId: 'same-device-id', deviceSecret: `secret-${host}`, deviceName: 'Phone', accessToken: `token-${host}` })
beforeEach(() => { store.clear() })

it('migrates the existing pairing once and preserves it when another Harness is added', async () => {
  await saveConfig(config('one.local'))
  const [one] = await storage.loadHarnesses()
  expect(one.config).toEqual(config('one.local'))
  const two = await storage.addHarness(config('two.local'))
  expect(two.id).not.toBe(one.id)
  expect((await storage.loadHarnesses()).map(h => h.id)).toEqual([one.id, two.id])
  await storage.selectHarness(one.id)
  expect(await storage.activeHarnessId()).toBe(one.id)
  expect(store.has('deviceSecret')).toBe(false)
})

it('isolates token renewal, endpoint changes and removal between Harnesses', async () => {
  const one = await storage.addHarness(config('one.local'))
  const two = await storage.addHarness(config('two.local'))
  store.set(`harness.${one.id}.token`, 'native-renewed')
  await storage.persistHarnessOrigin(one.id, 'http://one.ts.net')
  expect((await storage.readHarness(one.id)).config.accessToken).toBe('native-renewed')
  expect((await storage.readHarness(two.id)).config).toEqual(config('two.local'))
  await storage.removeHarness(one.id)
  expect((await storage.loadHarnesses()).map(h => h.id)).toEqual([two.id])
  expect(await storage.activeHarnessId()).toBe(two.id)
  expect(store.has(`harness.${one.id}.token`)).toBe(false)
})

it('defaults to the computer name and preserves a custom name across endpoint and token changes', async () => {
  const one = await storage.addHarness({ ...config('one.local:3080'), hostName: 'Office PC' })
  expect(one.name).toBe('Office PC')
  await storage.renameHarness(one.id, '  Work  ')
  await storage.persistHarnessOrigin(one.id, 'http://one.ts.net')
  await storage.persistHarnessToken(one.id, 'renewed')
  expect((await storage.readHarness(one.id)).name).toBe('Work')
  await expect(storage.renameHarness(one.id, '   ')).rejects.toThrow()
  expect((await storage.addHarness(config('two.local:3080'))).name).toBe('two.local')
  await storage.removeHarness(one.id)
  expect(store.has(`harness.${one.id}.name`)).toBe(false)
})
