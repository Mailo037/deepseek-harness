import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { Storage } from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import WebSocket from 'ws'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { NotificationBridge } from '../src/bridge.ts'
import { DeviceChannel } from '../src/device-channel.ts'
import { PairingService } from '../src/pairing.ts'
import { DeviceRegistry, REMOTE_DEVICES_DOMAIN } from '../src/registry.ts'
import type { NotificationFrame, PairedMessage } from '../src/types.ts'

const contexts: Context[] = []
const servers: Server[] = []

async function setup(bridgeConfig: { notifyOnError: boolean; notifyOnCompleted: boolean }) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.provide('storageDomain', facility)
  const domain = await facility.open(REMOTE_DEVICES_DOMAIN)
  const registry = new DeviceRegistry(domain)
  const pairing = new PairingService({
    endpoints: [], pairingTtlSeconds: 300,
    accessToken: 'access-token-test', port: 0,
  })
  const channel = new DeviceChannel(registry, pairing)
  const bridge = new NotificationBridge(ctx, bridgeConfig, channel)

  const server = createServer()
  servers.push(server)
  server.on('upgrade', (req, socket, head) => { channel.handleUpgrade(req, socket, head) })
  const port = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => { resolve((server.address() as { port: number }).port) })
  })

  // Pair one device.
  const { token } = await pairing.create()
  const ws = new WebSocket(`ws://127.0.0.1:${port}/remote/device`)
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => { resolve() })
    ws.once('error', reject)
  })
  ws.send(JSON.stringify({ type: 'pair', token, name: 'Pixel 8', platform: 'Android' }))
  const paired = await new Promise<PairedMessage>((resolve) => {
    ws.once('message', (raw) => { resolve(parseMessage(raw) as PairedMessage) })
  })

  const next = (): Promise<NotificationFrame> => new Promise((resolve) => {
    ws.once('message', (raw) => { resolve(parseMessage(raw) as NotificationFrame) })
  })

  return {
    ctx, ws, paired, next,
    close: async () => {
      channel.close()
      bridge.close()
      ws.close()
      await new Promise<void>(resolve => server.close(() => { resolve() }))
      await domain.close()
      await facility.closeAll()
    },
  }
}

/** Decode a WebSocket message without relying on RawData's object stringification. */
function parseMessage(raw: WebSocket.RawData): unknown {
  const bytes = Buffer.isBuffer(raw) ? raw : Array.isArray(raw) ? Buffer.concat(raw) : Buffer.from(raw)
  return JSON.parse(bytes.toString('utf8')) as unknown
}

afterEach(async () => {
  for (const s of servers.splice(0).reverse()) await new Promise<void>(resolve => s.close(() => { resolve() }))
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

function turnEnd(reason: unknown): never {
  return {
    type: 'turn/end',
    seq: 1,
    time: Date.now(),
    data: { turn: 1, reason },
  } as never
}

describe('NotificationBridge', () => {
  it('broadcasts a turn-error notification on turn/end error', async () => {
    const h = await setup({ notifyOnError: true, notifyOnCompleted: false })
    const session = Session.create(SessionId('s1'))
    session.append('session/title', {
      title: 'Repair provider routing', messageSeqs: [], source: { kind: 'user' },
    })
    h.ctx.emit('session/event', session, turnEnd({ kind: 'error', error: { message: 'provider down', code: 'UNKNOWN' } }))
    const frame = await h.next()
    expect(frame.type).toBe('notification')
    expect(frame.notification.kind).toBe('turn-error')
    expect(frame.notification.sessionId).toBe('s1')
    expect(frame.notification.message).toBe('Error in Repair provider routing: provider down')
    await h.close()
  })

  it('broadcasts a completed notification when enabled', async () => {
    const h = await setup({ notifyOnError: false, notifyOnCompleted: true })
    const session = Session.create(SessionId('s2'))
    session.append('session/title', {
      title: 'Polish Android notifications', messageSeqs: [], source: { kind: 'user' },
    })
    h.ctx.emit('session/event', session, turnEnd({ kind: 'completed' }))
    const frame = await h.next()
    expect(frame.notification.kind).toBe('turn-completed')
    expect(frame.notification.message).toBe('Polish Android notifications completed')
    await h.close()
  })

  it('falls back to the session id before a title exists', async () => {
    const h = await setup({ notifyOnError: false, notifyOnCompleted: true })
    const session = Session.create(SessionId('untitled-session'))
    h.ctx.emit('session/event', session, turnEnd({ kind: 'completed' }))
    const frame = await h.next()
    expect(frame.notification.message).toBe('untitled-session completed')
    await h.close()
  })

  it('stays silent for completed turns when disabled', async () => {
    const h = await setup({ notifyOnError: false, notifyOnCompleted: false })
    const session = Session.create(SessionId('s3'))
    let received = false
    h.ws.once('message', () => { received = true })
    h.ctx.emit('session/event', session, turnEnd({ kind: 'completed' }))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(received).toBe(false)
    await h.close()
  })

  it('ignores non-turn events', async () => {
    const h = await setup({ notifyOnError: true, notifyOnCompleted: true })
    const session = Session.create(SessionId('s4'))
    let received = false
    h.ws.once('message', () => { received = true })
    h.ctx.emit('session/event', session, { type: 'user/message', seq: 1, time: Date.now(), data: { messageId: 'm1', content: [] } } as never)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(received).toBe(false)
    await h.close()
  })
})
