/**
 * Simulated PC for the Harness Remote test device: serves a minimal fake GUI
 * (the iframe target the app loads on connect) and the `/remote/device`
 * WebSocket channel implementing the pairing handshake from
 * `apps/android/src/PairingProtocol.ts`. Zero dependencies — the WebSocket
 * server is a minimal RFC 6455 implementation (text frames only).
 *
 * Usage: node mock-pc-server.mjs [--port 31223] [--token TOKEN] [--reject]
 *        [--latency MS]
 * Probe state: GET /__status → { pairs, auths, rejects, guiRequests, authenticatedGuiRequests, shellMessages }
 */

import { createServer } from 'node:http'
import { createHash, randomUUID } from 'node:crypto'

const args = process.argv.slice(2)
function argOf(name, fallback) {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}

const PORT = Number(argOf('--port', '31223'))
const TOKEN = argOf('--token', 'TESTTOKEN123')
const ACCESS_TOKEN = 'GUIACCESS123'
const REJECT_ALL = args.includes('--reject')
const LATENCY_MS = Number(argOf('--latency', '0'))

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const status = { pairs: 0, auths: 0, rejects: 0, guiRequests: 0, authenticatedGuiRequests: 0, shellMessages: 0 }
const pairedSecrets = new Set()

const GUI_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>DSH Mock GUI</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#151517;color:#f9fafb}</style>
</head><body><main><h1>DSH MOCK GUI</h1><p>The simulated PC GUI for device testing.</p></main>
<script>addEventListener('message',event=>{const m=event.data;if(m&&m.type==='dsh/client-shell-context'&&m.version===1&&m.shell==='android'){fetch('/__shell',{method:'POST'});parent.postMessage({type:'dsh/client-connection-state',version:1,state:'connected'},'*')}})</script>
</body></html>`

/** Read one complete RFC 6455 client frame (masked) from the socket buffer. */
function readFrame(buffer, onFrame) {
  if (buffer.length < 2) return null
  const first = buffer[0]
  const second = buffer[1]
  const opcode = first & 0x0f
  const masked = (second & 0x80) !== 0
  let length = second & 0x7f
  let offset = 2
  if (length === 126) {
    if (buffer.length < offset + 2) return null
    length = buffer.readUInt16BE(offset)
    offset += 2
  } else if (length === 127) {
    if (buffer.length < offset + 8) return null
    length = Number(buffer.readBigUInt64BE(offset))
    offset += 8
  }
  let maskKey = null
  if (masked) {
    if (buffer.length < offset + 4) return null
    maskKey = buffer.subarray(offset, offset + 4)
    offset += 4
  }
  if (buffer.length < offset + length) return null
  const payload = Buffer.from(buffer.subarray(offset, offset + length))
  if (masked) {
    for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i % 4]
  }
  onFrame(opcode, payload)
  return buffer.subarray(offset + length)
}

/** Encode one unmasked server text frame. */
function encodeText(text) {
  const payload = Buffer.from(text, 'utf8')
  let header
  if (payload.length < 126) {
    header = Buffer.from([0x81, payload.length])
  } else {
    header = Buffer.alloc(4)
    header[0] = 0x81
    header[1] = 126
    header.writeUInt16BE(payload.length, 2)
  }
  return Buffer.concat([header, payload])
}

const server = createServer((request, response) => {
  const url = new URL(request.url, `http://localhost:${PORT}`)
  if (url.pathname === '/__status') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(status))
    return
  }
  if (url.pathname === '/__shell' && request.method === 'POST') {
    status.shellMessages += 1
    response.writeHead(204)
    response.end()
    return
  }
  // Every other path serves the fake GUI (the iframe target).
  status.guiRequests += 1
  if (url.searchParams.get('dsh_token') === ACCESS_TOKEN) status.authenticatedGuiRequests += 1
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  response.end(GUI_HTML)
})

server.on('upgrade', (request, socket) => {
  const url = new URL(request.url, `http://localhost:${PORT}`)
  if (url.pathname !== '/remote/device') {
    socket.destroy()
    return
  }
  const key = request.headers['sec-websocket-key']
  if (typeof key !== 'string') {
    socket.destroy()
    return
  }
  const accept = createHash('sha1').update(key + GUID).digest('base64')
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  )

  let buffer = Buffer.alloc(0)
  socket.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk])
    // Drain every complete frame the buffer currently holds.
    for (;;) {
      const rest = readFrame(buffer, (opcode, payload) => {
        if (opcode === 0x8) {
          socket.end()
          return
        }
        if (opcode === 0x9) {
          socket.write(Buffer.from([0x8a, payload.length]), () => socket.write(payload))
          return
        }
        if (opcode !== 0x1) return
        const message = JSON.parse(payload.toString('utf8'))
        void handleChannelMessage(message, frame => socket.write(encodeText(JSON.stringify(frame))))
      })
      if (rest === null) break
      buffer = rest
    }
  })
  socket.on('error', () => {
    // Client went away mid-handshake (app cancel/timeout): nothing to serve.
  })
})

async function handleChannelMessage(message, reply) {
  if (message?.type === 'auth') {
    if (!pairedSecrets.has(message.secret)) {
      status.rejects += 1
      reply({ type: 'rejected', reason: 'unknown secret' })
      return
    }
    status.auths += 1
    reply({ type: 'authed', deviceId: 'persisted-device', accessToken: ACCESS_TOKEN })
    return
  }
  if (message?.type !== 'pair') return
  if (LATENCY_MS > 0) await new Promise(resolve => setTimeout(resolve, LATENCY_MS))
  if (REJECT_ALL || message.token !== TOKEN) {
    status.rejects += 1
    reply({ type: 'rejected', reason: REJECT_ALL ? 'forced reject' : 'invalid token' })
    return
  }
  status.pairs += 1
  const secret = `sec-${randomUUID().slice(0, 12)}`
  pairedSecrets.add(secret)
  reply({
    type: 'paired',
    deviceId: `dev-${randomUUID().slice(0, 8)}`,
    secret,
    accessToken: ACCESS_TOKEN,
  })
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock-pc listening on http://127.0.0.1:${PORT} (token ${TOKEN}${REJECT_ALL ? ', rejecting all' : ''})`)
})
