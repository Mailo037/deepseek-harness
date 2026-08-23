#!/usr/bin/env node
/**
 * Smoke launcher: starts the Electron app in smoke mode (boot the host, open
 * the window, wait for the page, then exit 0) so the desktop path is
 * verifiable without a display and without leaving a window open.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const packaged = process.argv.includes('--packaged')
const packagedPathIndex = process.argv.indexOf('--packaged-path')
const executable = packagedPathIndex === -1
  ? join('release', 'win-unpacked', 'DeepSeek Harness.exe')
  : process.argv[packagedPathIndex + 1]
const command = packaged ? executable : process.platform === 'win32' ? 'npx.cmd' : 'npx'
const args = packaged ? [] : ['electron', '.']

if (packaged && (executable === undefined || !existsSync(executable))) {
  throw new Error(`packaged Electron executable not found: ${executable}`)
}

const child = spawn(command, args, {
  env: {
    ...process.env,
    DSH_ELECTRON_SMOKE: '1',
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
  throw error
})
child.on('exit', code => {
  clearTimeout(timeout)
  if (code !== 0 || !output.includes('ELECTRON_WINDOW_READY')) {
    process.stderr.write(`Electron smoke failed (exit ${String(code)}).\n${output}`)
    process.exitCode = 1
  }
})
