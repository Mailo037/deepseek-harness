import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Storage } from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { DeviceRegistry, REMOTE_DEVICES_DOMAIN } from '../src/registry.ts'
import type { RemoteDeviceId } from '../src/types.ts'

const contexts: Context[] = []
const domains: DomainFacility[] = []

afterEach(async () => {
  for (const d of domains.splice(0).reverse()) await d.closeAll()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

async function createRegistry(): Promise<DeviceRegistry> {
  const ctx = new Context()
  contexts.push(ctx)
  const pool = new MemoryMediaPool()
  const backend = new MemoryStorageBackend(pool)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', backend)
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.provide('storageDomain', facility)
  domains.push(facility)
  const domain = await facility.open(REMOTE_DEVICES_DOMAIN)
  return new DeviceRegistry(domain)
}

const device = (name: string, secretHash: string) => ({
  name,
  platform: 'Android',
  secretHash,
  createdAt: '2025-01-01T00:00:00Z',
  lastSeenAt: null as string | null,
})

describe('DeviceRegistry', () => {
  it('starts empty', async () => {
    const reg = await createRegistry()
    expect(reg.list()).toHaveLength(0)
    expect(reg.snapshot(() => false).devices).toHaveLength(0)
  })

  it('persists a device and returns it in list()', async () => {
    const reg = await createRegistry()
    const id = 'dev-1' as RemoteDeviceId
    await reg.create(id, device('Pixel 8', 'a'.repeat(64)))
    expect(reg.list()).toHaveLength(1)
    expect(reg.get(id)?.name).toBe('Pixel 8')
  })

  it('reports live connection status via snapshot callback', async () => {
    const reg = await createRegistry()
    const id = 'dev-1' as RemoteDeviceId
    await reg.create(id, device('Pixel 8', 'a'.repeat(64)))
    const snapshot = reg.snapshot(connected => connected === id)
    expect(snapshot.devices[0]?.connected).toBe(true)
  })

  it('touch() updates lastSeenAt', async () => {
    const reg = await createRegistry()
    const id = 'dev-1' as RemoteDeviceId
    await reg.create(id, device('Pixel 8', 'a'.repeat(64)))
    await reg.touch(id, '2025-06-01T00:00:00Z')
    expect(reg.get(id)?.lastSeenAt).toBe('2025-06-01T00:00:00Z')
  })

  it('remove() deletes the device; repeat remove resolves false', async () => {
    const reg = await createRegistry()
    const id = 'dev-1' as RemoteDeviceId
    await reg.create(id, device('Pixel 8', 'a'.repeat(64)))
    expect(await reg.remove(id)).toBe(true)
    expect(reg.get(id)).toBeUndefined()
    expect(await reg.remove(id)).toBe(false)
  })

  it('findBySecretHash locates the matching device', async () => {
    const reg = await createRegistry()
    await reg.create('dev-1' as RemoteDeviceId, device('Pixel 8', 'a'.repeat(64)))
    await reg.create('dev-2' as RemoteDeviceId, device('Tablet', 'b'.repeat(64)))
    const found = reg.findBySecretHash('b'.repeat(64))
    expect(found).toBeDefined()
    expect(found?.[0]).toBe('dev-2' as RemoteDeviceId)
    expect(found?.[1].name).toBe('Tablet')
  })

  it('persists across reopen on the same backend', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    const pool = new MemoryMediaPool()
    const backend = new MemoryStorageBackend(pool)
    await ctx.plugin(Storage)
    ctx.storage.backend.register('memory', backend)
    const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
    ctx.provide('storageDomain', facility)
    domains.push(facility)

    const domain1 = await facility.open(REMOTE_DEVICES_DOMAIN)
    const reg1 = new DeviceRegistry(domain1)
    const id = 'persist-1' as RemoteDeviceId
    await reg1.create(id, { ...device('Pixel 8', 'a'.repeat(64)), lastSeenAt: '2025-06-01T00:00:00Z' })
    await domain1.close()

    const domain2 = await facility.open(REMOTE_DEVICES_DOMAIN)
    const reg2 = new DeviceRegistry(domain2)
    expect(reg2.list()).toHaveLength(1)
    expect(reg2.get(id)?.name).toBe('Pixel 8')
    expect(reg2.get(id)?.lastSeenAt).toBe('2025-06-01T00:00:00Z')
  })

  it('access token defaults empty, is settable, and persists across reopen', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    const pool = new MemoryMediaPool()
    const backend = new MemoryStorageBackend(pool)
    await ctx.plugin(Storage)
    ctx.storage.backend.register('memory', backend)
    const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
    ctx.provide('storageDomain', facility)
    domains.push(facility)

    const domain1 = await facility.open(REMOTE_DEVICES_DOMAIN)
    const reg1 = new DeviceRegistry(domain1)
    expect(reg1.getAccessToken()).toBe('')
    await reg1.setAccessToken('persisted-token-123')
    await domain1.close()

    const domain2 = await facility.open(REMOTE_DEVICES_DOMAIN)
    const reg2 = new DeviceRegistry(domain2)
    expect(reg2.getAccessToken()).toBe('persisted-token-123')
  })
})
