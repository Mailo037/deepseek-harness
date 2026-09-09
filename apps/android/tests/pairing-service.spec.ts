import { afterEach, describe, expect, it, vi } from 'vitest'
import { pairWithQrData, pairWithToken } from '../src/PairingService.ts'

class Socket {
  static instances: Socket[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  send = vi.fn()
  close = vi.fn()
  constructor(readonly url: string) { Socket.instances.push(this) }
}

function setup(): void {
  Socket.instances = []
  vi.stubGlobal('WebSocket', Socket)
  vi.useFakeTimers()
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

const reply = { type: 'paired', deviceId: 'device', secret: 'secret', accessToken: 'gui' }
const qr = JSON.stringify({ v: 1, token: 'once', accessToken: '', endpoints: ['localhost:3080', 'pc.local:3080/path', 'pc.local:3080', 'other.local:3080'] })

describe('pairing connection lifecycle', () => {
  it('falls back after a clean close and stores exactly the normalized candidates', async () => {
    setup()
    const result = pairWithQrData(qr, 'Phone')
    expect(Socket.instances[0].url).toBe('ws://pc.local:3080/remote/device')
    Socket.instances[0].onclose?.()
    await vi.advanceTimersByTimeAsync(0)
    const socket = Socket.instances[1]
    socket.onopen?.()
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'pair', token: 'once', name: 'Phone', platform: 'Android' }))
    socket.onmessage?.({ data: 'null' })
    socket.onmessage?.({ data: JSON.stringify(reply) })
    expect(await result).toMatchObject({ serverUrl: 'http://other.local:3080', endpoints: ['http://pc.local:3080', 'http://other.local:3080'] })
    expect(vi.getTimerCount()).toBe(0)
    expect(socket.onmessage).toBeNull()
  })

  it('cancels the socket and clears its timeout without trying another address', async () => {
    setup()
    const controller = new AbortController()
    const result = pairWithQrData(qr, 'Phone', controller.signal)
    const rejected = expect(result).rejects.toThrow('Cancelled')
    controller.abort()
    await rejected
    expect(Socket.instances).toHaveLength(1)
    expect(Socket.instances[0].close).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('closes failed sockets and reports exhausted candidates', async () => {
    setup()
    const result = pairWithToken('https://pc.local/path', 'once', 'Phone')
    const rejected = expect(result).rejects.toThrow('WebSocket connection failed')
    expect(Socket.instances[0].url).toBe('wss://pc.local/remote/device')
    Socket.instances[0].onerror?.()
    await rejected
    expect(Socket.instances[0].close).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('releases a silent socket on timeout', async () => {
    setup()
    const result = pairWithToken('pc.local', 'once', 'Phone')
    const rejected = expect(result).rejects.toThrow('Connection timed out')
    await vi.advanceTimersByTimeAsync(10_000)
    await rejected
    expect(Socket.instances[0].onclose).toBeNull()
    expect(Socket.instances[0].close).toHaveBeenCalledOnce()
  })
})
