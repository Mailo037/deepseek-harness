import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import InvariantRegistry, { InvariantError } from '@deepseek-ai/dsh-invariants'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import * as RemoteInvariant from '../src/invariant.ts'
import { MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'

async function setup(): Promise<{ ctx: Context; facility: DomainFacility }> {
  const ctx = new Context()
  await ctx.plugin(Storage)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(RemoteInvariant)
  ctx.storage.backend.register('memory', new MemoryStorageBackend())
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  return { ctx, facility }
}

describe('host-remote invariant companion', () => {
  it('registers the package-owned installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(RemoteInvariant).await()).resolves.toBeDefined()
    await ctx.fiber.dispose()
  })

  it('rejects a persisted device record whose secret field is not a SHA-256 hex hash', async () => {
    const { ctx } = await setup()
    expect(() => {
      ctx.emit('domain/changed', {
        domain: 'remote_devices',
        table: 'devices',
        key: 'dev-1',
        operation: 'put',
        value: { name: 'Pixel 8', platform: 'Android', secretHash: 'plaintext-secret', createdAt: 'x', lastSeenAt: null },
      })
    }).toThrow(expect.objectContaining<Partial<InvariantError>>({
      code: 'INVARIANT',
      packageName: '@deepseek-ai/dsh-host-remote',
    }))
  })

  it('accepts a device record with a valid hash', async () => {
    const { ctx } = await setup()
    expect(() => {
      ctx.emit('domain/changed', {
        domain: 'remote_devices',
        table: 'devices',
        key: 'dev-1',
        operation: 'put',
        value: { name: 'Pixel 8', platform: 'Android', secretHash: 'a'.repeat(64), createdAt: 'x', lastSeenAt: null },
      })
    }).not.toThrow()
  })

  it('ignores changes in other domains and deletion tombstones', async () => {
    const { ctx } = await setup()
    expect(() => {
      ctx.emit('domain/changed', { domain: 'other', table: 'devices', key: 'k', operation: 'put', value: { anything: true } })
      ctx.emit('domain/changed', { domain: 'remote_devices', table: 'devices', key: 'dev-1', operation: 'deleted' })
    }).not.toThrow()
  })
})
