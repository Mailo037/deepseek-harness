#!/usr/bin/env node
/**
 * Smoke launcher: starts the Electron app in smoke mode (boot the host, open
 * the window, wait for the page, then exit 0) so the desktop path is
 * verifiable without a display and without leaving a window open.
 */
import { spawn } from 'node:child_process'

const child = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['electron', '.'], {
  env: { ...process.env, DSH_ELECTRON_SMOKE: '1' },
  stdio: 'inherit',
})
child.on('exit', code => process.exit(code ?? 1))
