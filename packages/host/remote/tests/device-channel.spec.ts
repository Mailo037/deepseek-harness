import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Storage } from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import WebSocket from 'ws'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { DeviceChannel, hashSecret } from '../src/device-channel.ts'
import { PairingService } from '../src/pairing.ts'
import { DeviceRegistry, REMOTE_DEVICES_DOMAIN } from '../src/registry.ts'
import type { AuthedMessage, NotificationFrame, PairedMessage, RejectedMessage } from '../src/types.ts'

interface Harness {
  ctx: Context
  server: Server
  channel: DeviceChannel
  pairing: PairingService
  registry: DeviceRegistry
  url: string
  close: () => Promise<void>
}

const contexts: Context[] = []
const servers: Server[] = []
const channels: DeviceChannel[] = []

async function createHarness(): Promise<Harness> {
  const ctx = new Context()
  contexts.push(ctx)
  const pool = new MemoryMediaPool()
  const backend = new MemoryStorageBackend(pool)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', backend)
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.provide('storageDomain', facility)
  const domain = await facility.open(REMOTE_DEVICES_DOMAIN)
  const registry = new DeviceRegistry(domain)
  const pairing = new PairingService({
    endpoints: [], pairingTtlSeconds: 300,
    accessToken: 'access-token-test', port: 0,
  })
  const channel = new DeviceChannel(registry, pairing)
  channels.push(channel)

  const server = createServer()
  servers.push(server)
  server.on('upgrade', (req, socket, head) => { channel.handleUpgrade(req, socket, head) })
  const port = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as { port: number }).port)
    })
  })
  return {
    ctx,
    server,
    channel,
    pairing,
    registry,
    url: `ws://127.0.0.1:${port}/remote/device`,
    close: async () => {
      channel.close()
      await new Promise<void>(resolve => server.close(() =>{  resolve() }))
      await domain.close()
      await facility.closeAll()
    },
  }
}

afterEach(async () => {
  for (const c of channels.splice(0).reverse()) c.close()
  for (const s of servers.splice(0).reverse()) await new Promise<void>(resolve => s.close(() =>{  resolve() }))
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

/** Open a client socket and wait for the next JSON message. */
function client(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.once('open', () =>{  resolve(ws) })
    ws.once('error', reject)
  })
}

function nextMessage(ws: WebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    ws.once('message', (raw) => {
      let text: string
      if (Array.isArray(raw)) text = Buffer.concat(raw).toString('utf8')
      else if (raw instanceof ArrayBuffer) text = Buffer.from(raw).toString('utf8')
      else text = raw.toString('utf8')
      resolve(JSON.parse(text))
    })
  })
}

describe('DeviceChannel', () => {
  it('pairs a device with a valid token and delivers its secret', async () => {
    const h = await createHarness()
    const { token } = await h.pairing.create()
    const ws = await client(h.url)
    ws.send(JSON.stringify({ type: 'pair', token, name: 'Pixel 8', platform: 'Android' }))
    const reply = await nextMessage(ws) as PairedMessage
    expect(reply.type).toBe('paired')
    expect(reply.deviceId).toBeTruthy()
    expect(reply.secret).toBeTruthy()
    expect(reply.accessToken).toBe('access-token-test')
    expect(h.registry.list()).toHaveLength(1)
    expect(h.registry.list()[0]?.name).toBe('Pixel 8')
    // The stored record holds only the hash, never the plaintext secret.
    expect(h.registry.list()[0]?.secretHash).toBe(hashSecret(reply.secret as string))
    ws.close()
  })

  it('rejects an invalid token and closes the socket', async () => {
    const h = await createHarness()
    const ws = await client(h.url)
    ws.send(JSON.stringify({ type: 'pair', token: 'nope', name: 'x', platform: 'y' }))
    const reply = await nextMessage(ws) as RejectedMessage
    expect(reply.type).toBe('rejected')
    expect(reply.reason).toContain('token')
    expect(h.registry.list()).toHaveLength(0)
    ws.close()
  })

  it('rejects a reused token (one-time pairing)', async () => {
    const h = await createHarness()
    const { token } = await h.pairing.create()
    const ws1 = await client(h.url)
    ws1.send(JSON.stringify({ type: 'pair', token, name: 'A', platform: 'Android' }))
    await nextMessage(ws1)
    const ws2 = await client(h.url)
    ws2.send(JSON.stringify({ type: 'pair', token, name: 'B', platform: 'Android' }))
    const reply = await nextMessage(ws2) as RejectedMessage
    expect(reply.type).toBe('rejected')
    expect(h.registry.list()).toHaveLength(1)
    ws1.close()
    ws2.close()
  })

  it('reconnects a paired device via its secret', async () => {
    const h = await createHarness()
    const { token } = await h.pairing.create()
    const ws1 = await client(h.url)
    ws1.send(JSON.stringify({ type: 'pair', token, name: 'Pixel 8', platform: 'Android' }))
    const paired = await nextMessage(ws1) as PairedMessage

    const ws2 = await client(h.url)
    ws2.send(JSON.stringify({ type: 'auth', secret: paired.secret }))
    const authed = await nextMessage(ws2) as AuthedMessage
    expect(authed.type).toBe('authed')
    expect(authed.deviceId).toBe(paired.deviceId)
    expect(authed.accessToken).toBe('access-token-test')
    expect(h.registry.get(paired.deviceId)?.lastSeenAt).toBeTruthy()
    ws1.close()
    ws2.close()
  })

  it('rejects an unknown secret', async () => {
    const h = await createHarness()
    const ws = await client(h.url)
    ws.send(JSON.stringify({ type: 'auth', secret: 'not-a-secret' }))
    const reply = await nextMessage(ws) as RejectedMessage
    expect(reply.type).toBe('rejected')
    ws.close()
  })

  it('delivers notifications to a connected device', async () => {
    const h = await createHarness()
    const { token } = await h.pairing.create()
    const ws = await client(h.url)
    ws.send(JSON.stringify({ type: 'pair', token, name: 'Pixel 8', platform: 'Android' }))
    const paired = await nextMessage(ws) as PairedMessage

    h.channel.notify(paired.deviceId, { kind: 'turn-error', sessionId: 's1', message: 'boom', time: '2025-01-01T00:00:00Z' })
    const frame = await nextMessage(ws) as NotificationFrame
    expect(frame.type).toBe('notification')
    expect(frame.notification.kind).toBe('turn-error')
    expect(frame.notification.sessionId).toBe('s1')
    ws.close()
  })

  it('revoke terminates the live connection immediately', async () => {
    const h = await createHarness()
    const { token } = await h.pairing.create()
    const ws = await client(h.url)
    ws.send(JSON.stringify({ type: 'pair', token, name: 'Pixel 8', platform: 'Android' }))
    const paired = await nextMessage(ws) as PairedMessage

    const closed = new Promise<void>(resolve => ws.once('close', () =>{  resolve() }))
    h.channel.revoke(paired.deviceId)
    await closed
    expect(h.channel.isConnected(paired.deviceId)).toBe(false)
    // The record stays (removal is the registry's job), but the socket is dead.
    expect(h.registry.get(paired.deviceId)).toBeTruthy()
  })

  it('broadcast reaches every connected device', async () => {
    const h = await createHarness()
    const t1 = await h.pairing.create()
    const ws1 = await client(h.url)
    ws1.send(JSON.stringify({ type: 'pair', token: t1.token, name: 'A', platform: 'Android' }))
    const p1 = await nextMessage(ws1) as PairedMessage

    const t2 = await h.pairing.create()
    const ws2 = await client(h.url)
    ws2.send(JSON.stringify({ type: 'pair', token: t2.token, name: 'B', platform: 'Android' }))
    const p2 = await nextMessage(ws2) as PairedMessage

    expect(p1.type).toBe('paired')
    expect(p2.type).toBe('paired')

    // Give the channel a moment to register both sockets.
    await new Promise(resolve => setTimeout(resolve, 20))

    h.channel.broadcast({ kind: 'turn-completed', sessionId: 's1', message: 'done', time: '2025-01-01T00:00:00Z' })
    const f1 = await nextMessage(ws1) as NotificationFrame
    const f2 = await nextMessage(ws2) as NotificationFrame
    expect(f1.notification.kind).toBe('turn-completed')
    expect(f2.notification.kind).toBe('turn-completed')
    ws1.close()
    ws2.close()
  })
})
