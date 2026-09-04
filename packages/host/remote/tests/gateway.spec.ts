import { afterEach, describe, expect, it } from 'vitest'
import { Readable } from 'node:stream'
import type { IncomingMessage } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import { Storage } from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionTitleService from '@deepseek-ai/dsh-session-title'
import WebSocket from 'ws'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import RemoteGateway, { DEVICE_PATH, REMOTE_PAGE_PATH } from '../src/index.ts'
import { ACCESS_COOKIE_SCRIPT } from '../src/auth.ts'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import type { NotificationFrame, PairedMessage } from '../src/types.ts'

const contexts: Context[] = []

async function harness(): Promise<{
  ctx: Context
  gateway: RemoteGateway
  wsUrl: string
  port: number
}> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionTitleService, {
    fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80,
  })
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.provide('storageDomain', facility)

  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(RemoteGateway, {
    endpoints: [],
    pairingTtlSeconds: 300,
    notifyOnError: true,
    notifyOnCompleted: true,
    notifyOnAttention: true,
    printPairingQr: false,
  })
  const gateway = ctx.get('device') as RemoteGateway
  const port = ctx.webServer.port
  return { ctx, gateway, port, wsUrl: `ws://127.0.0.1:${port}${DEVICE_PATH}` }
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

async function pairDevice(wsUrl: string, token: string, name = 'Pixel 8'): Promise<{ ws: WebSocket; paired: PairedMessage }> {
  const ws = new WebSocket(wsUrl)
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => { resolve() })
    ws.once('error', reject)
  })
  ws.send(JSON.stringify({ type: 'pair', token, name, platform: 'Android' }))
  const paired = await new Promise<PairedMessage>((resolve) => {
    ws.once('message', (raw) => { resolve(parseMessage(raw) as PairedMessage) })
  })
  return { ws, paired }
}

/** Minimal request carrier for exercising the auth waterfall without a socket. */
function authRequest(
  remoteAddress: string,
  headers: Record<string, string>,
  url = '/api/device/devicesList',
): IncomingMessage {
  const request = Readable.from([]) as unknown as IncomingMessage
  Object.assign(request, {
    headers,
    url,
    socket: { remoteAddress },
  })
  return request
}

/** Decode a WebSocket message without relying on RawData's object stringification. */
function parseMessage(raw: WebSocket.RawData): unknown {
  const bytes = Buffer.isBuffer(raw) ? raw : Array.isArray(raw) ? Buffer.concat(raw) : Buffer.from(raw)
  return JSON.parse(bytes.toString('utf8')) as unknown
}

describe('RemoteGateway (real WebServer composition)', () => {
  it('publishes the device namespace with the expected methods', async () => {
    const { gateway } = await harness()
    expect(gateway.typertRemote).toMatchObject({
      serviceKey: 'device',
      namespace: 'device',
    })
    expect(remoteMethods(gateway).map(m => m.method).sort()).toEqual([
      'accessTokenGet', 'devicesList', 'devicesRevoke', 'pairingCreate',
    ])
  })

  it('creates a pairing view with a one-time token, QR payload, data URL, and access token', async () => {
    const { gateway, port } = await harness()
    const view = await gateway.pairingCreate()
    expect(view.token).toBeTruthy()
    expect(view.expiresAt).toBeTruthy()
    expect(view.qrDataUrl).toMatch(/^data:image\/png;base64,/)
    const payload = JSON.parse(view.payload) as { v: number; token: string; endpoints: string[]; accessToken: string }
    expect(payload.v).toBe(1)
    expect(payload.token).toBe(view.token)
    expect(payload.endpoints).toContain(`127.0.0.1:${port}`)
    expect(payload.accessToken).toBeTruthy()
    expect(payload.accessToken).toBe(gateway.accessTokenGet().accessToken)
  })

  it('lists a paired device as connected, then revoke kills it and empties the list', async () => {
    const { gateway, wsUrl } = await harness()
    const view = await gateway.pairingCreate()
    const { ws, paired } = await pairDevice(wsUrl, view.token)

    const listed = gateway.devicesList()
    expect(listed.devices).toHaveLength(1)
    expect(listed.devices[0]?.connected).toBe(true)
    expect(listed.devices[0]?.name).toBe('Pixel 8')

    const closed = new Promise<void>(resolve => ws.once('close', () => { resolve() }))
    const receipt = await gateway.devicesRevoke({ deviceId: paired.deviceId })
    expect(receipt.revoked).toBe(true)
    await closed
    expect(gateway.devicesList().devices).toHaveLength(0)
  })

  it('pushes the durable session title in a completed-turn notification', async () => {
    const { ctx, gateway, wsUrl } = await harness()
    const view = await gateway.pairingCreate()
    const { ws } = await pairDevice(wsUrl, view.token)
    const next = new Promise<NotificationFrame>((resolve) => {
      ws.once('message', (raw) => { resolve(parseMessage(raw) as NotificationFrame) })
    })

    const session = ctx.sessions.create(SessionId('remote-title'))
    session.append('session/title', {
      title: 'Use titles in Android alerts', messageSeqs: [], source: { kind: 'user' },
    })
    session.append('turn/start', { turn: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    await expect(next).resolves.toMatchObject({
      type: 'notification',
      notification: {
        kind: 'turn-completed',
        sessionId: 'remote-title',
        message: 'Use titles in Android alerts completed',
      },
    })
    ws.close()
  })

  it('devicesRevoke on an unknown device resolves revoked=false', async () => {
    const { gateway } = await harness()
    const receipt = await gateway.devicesRevoke({ deviceId: 'ghost' as never })
    expect(receipt.revoked).toBe(false)
  })

  it('serves a standalone pairing page with a fresh QR payload at /remote', async () => {
    const { port } = await harness()
    const response = await fetch(`http://127.0.0.1:${port}${REMOTE_PAGE_PATH}`)
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('远程设备配对')
    expect(html).toContain('data:image/png;base64,')
    expect(html).toContain('"token"')
    // A second GET mints a fresh code (the previous one is retired).
    const second = await fetch(`http://127.0.0.1:${port}${REMOTE_PAGE_PATH}`)
    const secondHtml = await second.text()
    expect(secondHtml).not.toBe(html)
  })

  it('a token is one-time across the real channel', async () => {
    const { gateway, wsUrl } = await harness()
    const view = await gateway.pairingCreate()
    const { ws, paired } = await pairDevice(wsUrl, view.token)

    // Second device with the same token must be rejected.
    const ws2 = new WebSocket(wsUrl)
    await new Promise<void>((resolve, reject) => {
      ws2.once('open', () => { resolve() })
      ws2.once('error', reject)
    })
    ws2.send(JSON.stringify({ type: 'pair', token: view.token, name: 'Other', platform: 'Android' }))
    const rejected = await new Promise<{ type: string }>((resolve) => {
      ws2.once('message', (raw) => { resolve(parseMessage(raw) as { type: string }) })
    })
    expect(rejected.type).toBe('rejected')
    expect(gateway.devicesList().devices).toHaveLength(1)
    expect(gateway.devicesList().devices[0]?.deviceId).toBe(paired.deviceId)
    ws.close()
    ws2.close()
  })

  it('the GUI access token is generated once per storage domain and returned via accessTokenGet', async () => {
    const { gateway } = await harness()
    const token = gateway.accessTokenGet().accessToken
    expect(token).toBeTruthy()
    expect(token.length).toBe(64) // randomBytes(32).hex
    // Repeated reads return the same generated token.
    expect(gateway.accessTokenGet().accessToken).toBe(token)
    // A fresh storage domain generates a fresh token (persistence across
    // reopen is covered by the registry suite on one shared backend).
    const { gateway: gateway2 } = await harness()
    expect(gateway2.accessTokenGet().accessToken).not.toBe(token)
  })

  it('the index script exposes and retains the GUI token for browser connection carriers', () => {
    expect(ACCESS_COOKIE_SCRIPT).toContain("window.__DSH_REQUEST_AUTH__ = { query: { 'dsh_token': token } }")
    expect(ACCESS_COOKIE_SCRIPT).toContain('sessionStorage.setItem(storageKey, token)')
    expect(ACCESS_COOKIE_SCRIPT).toContain('sessionStorage.getItem(storageKey)')
  })

  it('the auth waterfall allows loopback-originated requests without a token', async () => {
    const { ctx } = await harness()
    const loopback = authRequest('127.0.0.1', {
      host: '192.168.1.5:3080', // spoofed Host must NOT matter
    })
    const result = ctx.waterfall('connection/authenticate', loopback, () => true)
    expect(result).toBe(true)
  })

  it('the auth waterfall blocks non-loopback requests without a token', async () => {
    const { ctx } = await harness()
    const lan = authRequest('192.168.1.5', {
      host: '127.0.0.1:3080', // loopback Host must NOT bypass
    })
    const result = ctx.waterfall('connection/authenticate', lan, () => true)
    expect(result).toBe(false)
  })

  it('the auth waterfall allows non-loopback requests with the correct cookie', async () => {
    const { ctx, gateway } = await harness()
    const token = gateway.accessTokenGet().accessToken
    const lan = authRequest('192.168.1.5', {
      host: '192.168.1.5:3080',
      cookie: `dsh_access=${token}`,
    })
    const result = ctx.waterfall('connection/authenticate', lan, () => true)
    expect(result).toBe(true)
  })

  it('the auth waterfall allows non-loopback requests with Authorization header', async () => {
    const { ctx, gateway } = await harness()
    const token = gateway.accessTokenGet().accessToken
    const lan = authRequest('192.168.1.5', {
      host: '192.168.1.5:3080',
      authorization: `Bearer ${token}`,
    })
    const result = ctx.waterfall('connection/authenticate', lan, () => true)
    expect(result).toBe(true)
  })

  it('the auth waterfall allows a WebSocket downlink carrying the query token', async () => {
    const { ctx, gateway } = await harness()
    const token = gateway.accessTokenGet().accessToken
    const lan = authRequest(
      '192.168.1.5',
      { host: '192.168.1.5:3080' },
      `/api/events.mux?dsh_token=${encodeURIComponent(token)}`,
    )
    const result = ctx.waterfall('connection/authenticate', lan, () => true)
    expect(result).toBe(true)
  })
})
