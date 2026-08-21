/**
 * Plain-Node smoke entry for the Electron host boot: boots the web profile
 * without Electron, prints the ready line, and shuts down on stdin EOF or a
 * `q` line. Used by the host smoke test to exercise the real boot path in a
 * subprocess (one module instance, node_modules resolution, no vitest
 * source rewriting).
 * @module @deepseek-ai/dsh-electron/smoke
 */

import { bootWebHost } from './host.ts'

const host = await bootWebHost({ port: 0 })
console.log(`ELECTRON_HOST_READY ${host.url}`)

let requested = false
async function shutdown(code: number): Promise<void> {
  if (requested) return
  requested = true
  await host.shutdown()
  process.exit(code)
}

process.on('SIGTERM', () => { void shutdown(0) })
process.on('SIGINT', () => { void shutdown(130) })
process.stdin.on('data', (chunk) => {
  if (chunk.toString().trim() === 'q') void shutdown(0)
})
process.stdin.on('end', () => { void shutdown(0) })
