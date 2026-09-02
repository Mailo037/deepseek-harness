#!/usr/bin/env node
/**
 * Smoke launcher: starts the Electron app in smoke mode (boot the host, open
 * the window, wait for the page, then exit 0) so the desktop path is
 * verifiable without a display and without leaving a window open.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const packaged = process.argv.includes('--packaged')
const packagedPathIndex = process.argv.indexOf('--packaged-path')
const executable = packagedPathIndex === -1
  ? join('release', 'win-unpacked', 'DeepSeek Harness.exe')
  : process.argv[packagedPathIndex + 1]
const require = createRequire(import.meta.url)
const command = packaged ? executable : process.execPath
const args = packaged ? [] : [require.resolve('electron/cli.js'), '.']

if (packaged && (executable === undefined || !existsSync(executable))) {
  throw new Error(`packaged Electron executable not found: ${executable}`)
}

const smokeHome = mkdtempSync(join(tmpdir(), 'dsh-electron-window-'))
const readyMarker = join(smokeHome, 'window-ready')
const child = spawn(command, args, {
  env: {
    ...process.env,
    DSH_HOME: smokeHome,
    DSH_ELECTRON_SMOKE: '1',
    DSH_ELECTRON_SMOKE_READY: readyMarker,
    DSH_ELECTRON_DISABLE_AUTO_UPDATE: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let output = ''
child.stdout.setEncoding('utf8')
child.stderr.setEncoding('utf8')
child.stdout.on('data', chunk => { output += chunk; process.stdout.write(chunk) })
child.stderr.on('data', chunk => { output += chunk; process.stderr.write(chunk) })
const timeout = setTimeout(() => {
  child.kill()
}, 90_000)
child.on('error', error => {
  clearTimeout(timeout)
  rmSync(smokeHome, { recursive: true, force: true })
  throw error
})
child.on('exit', code => {
  clearTimeout(timeout)
  const windowReady = existsSync(readyMarker)
  rmSync(smokeHome, { recursive: true, force: true })
  if (code !== 0 || !windowReady) {
    process.stderr.write(`Electron smoke failed (exit ${String(code)}).\n${output}`)
    process.exitCode = 1
  }
})
