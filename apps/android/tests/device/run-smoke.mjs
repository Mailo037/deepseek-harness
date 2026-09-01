/**
 * Device smoke runner for the Harness Remote Android app. Drives the real
 * Capacitor WebView over the Chrome DevTools Protocol (via `adb forward`)
 * through one phase of the app flow and asserts what the user would see.
 * The mock PC (`mock-pc-server.mjs`) plays the computer side.
 *
 * Node ≥ 22 only (built-in WebSocket, fetch). It spawns no processes: adb
 * and emulator lifecycle belong to the pwsh orchestration in the README.
 *
 * Phases:
 *   pairing-happy   splash → pairing → connect (10.0.2.2:31223) → connected
 *   seed-stale-token replace the stored GUI token for refresh regression setup
 *   persisted       relaunch lands directly on the connected screen
 *   disconnect      Disconnect → pairing screen, stored config gone
 *   cleared         relaunch lands on the pairing screen
 *   errors          wrong token banner, unreachable host banner, cancel path
 *
 * Usage: node run-smoke.mjs --phase pairing-happy [--cdp-port 9223]
 *        [--mock http://127.0.0.1:31223] [--artifact-dir .artifacts/android-device]
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

function argOf(name, fallback) {
  const args = process.argv.slice(2)
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}

const CDP_PORT = Number(argOf('--cdp-port', '9223'))
const MOCK = argOf('--mock', 'http://127.0.0.1:31223')
const PHASE = argOf('--phase', 'pairing-happy')
const ARTIFACTS = argOf('--artifact-dir', '.artifacts/android-device')
mkdirSync(ARTIFACTS, { recursive: true })

const results = []
function record(step, ok, detail = '') {
  results.push({ step, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail !== '' ? ` — ${detail}` : ''}`)
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/** Minimal CDP client over the Node built-in WebSocket. */
class Cdp {
  static async connect() {
    const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)
    const targets = (await response.json()).filter(target => target.type === 'page')
    const page = targets.find(target => target.url.includes('localhost')) ?? targets[0]
    if (page === undefined) throw new Error(`no page target on :${CDP_PORT}`)
    const ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      ws.onopen = resolve
      ws.onerror = () => reject(new Error('CDP websocket failed'))
    })
    return new Cdp(ws)
  }

  constructor(ws) {
    this.ws = ws
    this.nextId = 0
    this.pending = new Map()
    this.consoleErrors = []
    this.ws.addEventListener('message', event => {
      const message = JSON.parse(event.data)
      if (message.id !== undefined && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id)
        this.pending.delete(message.id)
        if (message.error !== undefined) pending.reject(new Error(JSON.stringify(message.error)))
        else pending.resolve(message.result)
      } else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        this.consoleErrors.push(JSON.stringify(message.params.args))
      } else if (message.method === 'Runtime.exceptionThrown') {
        this.consoleErrors.push(JSON.stringify(message.params.exceptionDetails))
      }
    })
  }

  send(method, params = {}) {
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  /** Evaluate an expression, awaiting its promise, returning the JSON value. */
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    })
    if (result.exceptionDetails !== undefined) {
      throw new Error(`page exception: ${JSON.stringify(result.exceptionDetails).slice(0, 400)}`)
    }
    return result.result.value
  }

  async screenshot(name) {
    const result = await this.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(ARTIFACTS, `${name}.png`), Buffer.from(result.data, 'base64'))
    console.log(`SHOT  ${join(ARTIFACTS, `${name}.png`)}`)
  }

  close() {
    this.ws.close()
  }
}

/** Poll a page expression until truthy or timeout; returns the last value. */
async function waitFor(cdp, expression, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs
  let value = null
  while (Date.now() < deadline) {
    value = await cdp.evaluate(`(() => { try { return ${expression} } catch { return false } })()`)
    if (value !== false && value !== null && value !== undefined) return value
    await sleep(200)
  }
  throw new Error(`timeout waiting for ${label}`)
}

/** Page-side probe: which screen is showing. */
const SCREEN = `(() => {
  const text = sel => document.querySelector(sel)?.textContent ?? ''
  if (document.querySelector('.steps') !== null) return 'connecting'
  if (document.querySelector('.iframe-bar') !== null) return 'connected'
  if (document.querySelector('.splash-mark') !== null && document.querySelector('.option-button') === null && document.querySelector('.banner') === null) return 'splash'
  if (document.querySelector('.option-button') !== null) return 'pairing'
  return 'unknown: ' + document.body.textContent.slice(0, 80)
})()`

const SCREENSHOT_INDEX = { count: 0 }
async function shot(cdp, name) {
  SCREENSHOT_INDEX.count += 1
  await cdp.screenshot(`${String(SCREENSHOT_INDEX.count).padStart(2, '0')}-${name}`).catch(error => {
    console.log(`SHOT-FAIL ${name}: ${error.message}`)
  })
}

async function connectAndRun(cdp, mockUrl, token) {
  // React controlled inputs need the native value setter + an input event.
  const fill = (selector, value) => cdp.evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)})
    if (input === null) throw new Error('missing ' + ${JSON.stringify(selector)})
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, ${JSON.stringify(value)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  const click = selector => cdp.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (el === null) throw new Error('missing ' + ${JSON.stringify(selector)})
    el.click()
    return true
  })()`)

  record('pairing screen shows', (await waitFor(cdp, `${SCREEN}.includes('pairing')`, 20_000, 'pairing screen')) === true)
  record('brand wordmark', (await cdp.evaluate(`document.querySelector('.brand-word')?.textContent`)) === 'Harness Remote')
  record('scan option present', await cdp.evaluate(`document.querySelector('.option-button') !== null`))
  record('flat manual form fields', await cdp.evaluate(`document.querySelector('.manual-form') !== null && document.querySelector('.card') === null && document.querySelector('#manual-url') !== null && document.querySelector('#manual-token') !== null`))
  await shot(cdp, 'pairing')

  await fill('#manual-url', mockUrl)
  await fill('#manual-token', token)
  await click('.manual-form .button')
  record('connecting flow appears', (await waitFor(cdp, `${SCREEN}.includes('connecting')`, 8_000, 'connecting screen')) === true)
  record('three-step connecting flow', await cdp.evaluate(`document.querySelectorAll('.step').length === 3`))
  await shot(cdp, 'connecting')
}

async function main() {
  const cdp = await Cdp.connect()
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  try {
    if (PHASE === 'pairing-happy') {
      await connectAndRun(cdp, '10.0.2.2:31223', 'TESTTOKEN123')
      record('reaches connected screen', (await waitFor(cdp, `${SCREEN}.includes('connected')`, 20_000, 'connected screen')) === true)
      record('status bar hides server', !(((await cdp.evaluate(`document.querySelector('.iframe-bar')?.textContent`)) ?? '').includes('10.0.2.2:31223')))
      record('embedded GUI settles the inline status', (await waitFor(cdp, `document.querySelector('.connection-status')?.dataset.state === 'connected'`, 10_000, 'connected inline status')) === true)
      record('dot reports connected', (await cdp.evaluate(`document.querySelector('.connection-status .dot')?.className`))?.includes('connected') === true)
      record('iframe element present', await cdp.evaluate(`document.querySelector('.iframe-remote') !== null`))
      await cdp.evaluate(`document.querySelector('[aria-label="Show connection details"]')?.click()`)
      record('connection address starts covered', await cdp.evaluate(`document.querySelector('.connection-address')?.dataset.addressRevealed === 'false' && document.querySelector('[aria-label="Show connected computer address"]') !== null`))
      await cdp.evaluate(`document.querySelector('[aria-label="Show connected computer address"]')?.click()`)
      record('connection details reveal server', ((await cdp.evaluate(`document.querySelector('.connection-details-url')?.textContent`)) ?? '').includes('10.0.2.2:31223'))
      const status = await (await fetch(`${MOCK}/__status`)).json()
      record('mock PC saw the pair handshake', status.pairs >= 1, JSON.stringify(status))
      await sleep(1_200)
      const connectedStatus = await (await fetch(`${MOCK}/__status`)).json()
      record('mock PC served the GUI to the iframe', connectedStatus.guiRequests >= 1, `guiRequests=${connectedStatus.guiRequests}`)
      record('native channel authenticated after pairing', connectedStatus.auths >= 1, JSON.stringify(connectedStatus))
      record('manual pairing authenticates GUI requests', connectedStatus.authenticatedGuiRequests >= 1, JSON.stringify(connectedStatus))
      record('iframe received Android shell context', (await (await fetch(`${MOCK}/__status`)).json()).shellMessages >= 1)
      await shot(cdp, 'connected')
    } else if (PHASE === 'seed-stale-token') {
      record('starts from connected screen', (await waitFor(cdp, `${SCREEN}.includes('connected')`, 10_000, 'connected screen')) === true)
      const seeded = await cdp.evaluate(`window.Capacitor.Plugins.Preferences.set({ key: 'accessToken', value: 'GUIACCESS12' }).then(() => true)`)
      record('stored GUI token made stale', seeded === true)
    } else if (PHASE === 'persisted') {
      record('relaunch lands on connected screen', (await waitFor(cdp, `${SCREEN}.includes('connected')`, 20_000, 'connected screen')) === true)
      record('native channel repaired the GUI URL', (await waitFor(cdp, `document.querySelector('.iframe-remote')?.src.includes('dsh_token=GUIACCESS123') ?? false`, 10_000, 'refreshed GUI token')) === true)
      await shot(cdp, 'persisted-connected')
    } else if (PHASE === 'disconnect') {
      record('starts from connected screen', (await waitFor(cdp, `${SCREEN}.includes('connected')`, 10_000, 'connected screen')) === true)
      await cdp.evaluate(`document.querySelector('[aria-label="Show connection details"]')?.click()`)
      await cdp.evaluate(`document.querySelector('.connection-details .danger')?.click()`)
      record('disconnect returns to pairing', (await waitFor(cdp, `${SCREEN}.includes('pairing')`, 10_000, 'pairing screen')) === true)
      await shot(cdp, 'after-disconnect')
    } else if (PHASE === 'cleared') {
      record('relaunch lands on pairing screen', (await waitFor(cdp, `${SCREEN}.includes('pairing')`, 20_000, 'pairing screen')) === true)
      await shot(cdp, 'cleared-pairing')
    } else if (PHASE === 'errors') {
      // Wrong token → clear banner with the server's reason.
      const fill = (selector, value) => cdp.evaluate(`(() => {
        const input = document.querySelector(${JSON.stringify(selector)})
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        setter.call(input, ${JSON.stringify(value)})
        input.dispatchEvent(new Event('input', { bubbles: true }))
        return true
      })()`)
      const click = selector => cdp.evaluate(`document.querySelector(${JSON.stringify(selector)})?.click()`)

      await fill('#manual-url', '10.0.2.2:31223')
      await fill('#manual-token', 'WRONGTOKEN')
      await click('.manual-form .button')
      await waitFor(cdp, `${SCREEN}.includes('connecting')`, 8_000, 'connecting screen')
      const banner = await waitFor(cdp, `document.querySelector('.banner')?.textContent ?? false`, 15_000, 'rejection banner')
      record('wrong token shows banner', typeof banner === 'string' && banner.includes('invalid token'), String(banner).slice(0, 80))
      await shot(cdp, 'error-banner')

      // Unreachable host → endpoint failures surface without the prefix jargon.
      await fill('#manual-url', '10.0.2.2:39999')
      await fill('#manual-token', 'ANYTOKEN')
      await click('.manual-form .button')
      const banner2 = await waitFor(cdp, `document.querySelector('.banner')?.textContent ?? false`, 20_000, 'unreachable banner')
      record('unreachable host shows banner', typeof banner2 === 'string' && banner2.length > 0 && !banner2.includes('All endpoints failed'), String(banner2).slice(0, 80))

      // Cancel during a slow handshake returns to the form without an error.
      await fill('#manual-url', '10.0.2.2:31224')
      await fill('#manual-token', 'SLOWTOKEN')
      await click('.manual-form .button')
      await waitFor(cdp, `${SCREEN}.includes('connecting')`, 8_000, 'slow connecting screen')
      await cdp.evaluate(`[...document.querySelectorAll('.button')].find(b => b.textContent === 'Cancel')?.click()`)
      record('cancel returns to pairing without banner', (await waitFor(cdp, `${SCREEN}.includes('pairing')`, 8_000, 'pairing screen')) === true && (await cdp.evaluate(`document.querySelector('.banner') === null`)) === true)
      await shot(cdp, 'after-cancel')
    } else {
      throw new Error(`unknown phase ${PHASE}`)
    }
  } finally {
    if (cdp.consoleErrors.length > 0) {
      console.log(`CONSOLE-ERRORS (${cdp.consoleErrors.length}):`)
      for (const line of cdp.consoleErrors.slice(0, 10)) console.log(`  ${line.slice(0, 200)}`)
    }
    cdp.close()
  }

  const failed = results.filter(entry => !entry.ok)
  console.log(`PHASE ${PHASE}: ${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length > 0) process.exitCode = 1
}

try {
  await main()
} catch (error) {
  console.log(`PHASE ${PHASE}: ABORTED — ${error.message}`)
  process.exitCode = 1
}
