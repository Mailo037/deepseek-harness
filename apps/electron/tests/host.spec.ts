import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * Boots the real web profile in a plain-Node subprocess (the same path the
 * Electron main uses, minus Electron) and verifies the served GUI: the host
 * prints the ready line, the root document carries the client boot manifest,
 * and the shutdown path flushes and exits cleanly.
 */

const SMOKE_ENTRY = fileURLToPath(new URL('../lib/types/smoke.js', import.meta.url))

// The assembled Loader resolves package exports from built lib/ artifacts.
// Clean-tree unit lanes leave this artifact-plane smoke to the build/release lane.
describe.skipIf(!existsSync(SMOKE_ENTRY))('dsh-electron host boot', () => {
  let home: string | undefined

  beforeAll(() => {
    // A throwaway DSH_HOME keeps the boot from touching the real profile,
    // sessions, and settings on disk.
    home = mkdtempSync(join(tmpdir(), 'dsh-electron-host-'))
    vi.stubEnv('DSH_HOME', home)
  })

  afterAll(() => {
    vi.unstubAllEnvs()
    if (home !== undefined) rmSync(home, { recursive: true, force: true })
  })

  it('discovers shipped presets, serves the browser UI, and shuts down on demand', async () => {
    const child = spawn(process.execPath, [SMOKE_ENTRY], {
      env: { ...process.env, DSH_HOME: home },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.stderr.on('data', (chunk: string) => { stderr += chunk })

    try {
      const url = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`host did not become ready; stdout:\n${stdout}\nstderr:\n${stderr}`))
        }, 60_000)
        child.stdout.on('data', () => {
          const match = stdout.match(/ELECTRON_HOST_READY (http:\/\/127\.0\.0\.1:\d+)/)
          if (match !== null) {
            clearTimeout(timer)
            resolve(match[1]!)
          }
        })
        child.on('exit', (code) => {
          clearTimeout(timer)
          reject(new Error(`host exited early with code ${String(code)}; stdout:\n${stdout}\nstderr:\n${stderr}`))
        })
        child.on('error', (error) => {
          clearTimeout(timer)
          reject(error)
        })
      })

      // The served root document is the real web shell, with the host's
      // boot-manifest injection (the page cannot boot without it). The
      // renderer may spell the global as `window.__DSH_BOOT__` or the
      // equivalent `globalThis["__DSH_BOOT__"]` row form.
      expect(stdout).toContain('ELECTRON_HOST_PRESETS ["code","cordis","minimal","standard"]')
      const response = await fetch(url)
      expect(response.status).toBe(200)
      const html = await response.text()
      expect(html).toMatch(/window\.__DSH_BOOT__|globalThis\["__DSH_BOOT__"\]/)

      // Request a clean shutdown and wait for the process to exit.
      const exited = new Promise<number | null>((resolve) => {
        child.on('exit', (code) => { resolve(code) })
      })
      child.stdin.write('q\n')
      const code = await exited
      expect(code).toBe(0)
    } finally {
      child.kill()
    }
  }, 90_000)
})
