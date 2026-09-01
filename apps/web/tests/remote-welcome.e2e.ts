// Trusted non-loopback Web access cannot call the loopback-only settings API;
// the notice therefore advances for this browser process and returns on reload.
import type { Browser, Page, WebSocket } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  acknowledgeReloadConnectionLoss, launchWebScaffold, watchConsole, webSnapshotMode,
  WELCOME_NOTICE_COPY,
  type WebScaffold,
} from './scaffold.ts'
import { ZH_BROWSER_LOCALE } from './support.ts'

const MODE = webSnapshotMode()

describe.skipIf(MODE === 'record')('web e2e: remote welcome notice', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      remoteAuthority: 'remote.localhost',
      welcomeNoticePending: true,
    })
    browser = await chromium.launch()
    page = await browser.newPage({
      viewport: { width: 1440, height: 960 },
      locale: ZH_BROWSER_LOCALE,
    })
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('#root', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('advances process-locally and presents the notice again after reload', async () => {
    const welcome = page.getByRole('dialog', { name: WELCOME_NOTICE_COPY.zh.title })
    await welcome.waitFor({ timeout: 15_000 })
    expect(await page.locator('#root').evaluate(root => (root as HTMLElement).inert)).toBe(true)

    await welcome.getByRole('button', { name: WELCOME_NOTICE_COPY.zh.continueLabel }).click()
    await welcome.waitFor({ state: 'detached', timeout: 15_000 })
    await expect.poll(
      () => page.locator('#root').evaluate(root => (root as HTMLElement).inert),
      { timeout: 15_000 },
    ).toBe(false)

    const reloadWarnings = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    acknowledgeReloadConnectionLoss(tripwire, reloadWarnings)
    await welcome.waitFor({ timeout: 15_000 })
    expect(tripwire.warnings).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)
})

it.skipIf(MODE === 'record')('keeps remote event sockets open without secure-context randomUUID', async () => {
  const remoteHost = 'remote.test'
  const scaffold = await launchWebScaffold({
    remoteAuthority: remoteHost,
    welcomeNoticePending: true,
  })
  const browser = await chromium.launch({
    args: [`--host-resolver-rules=MAP ${remoteHost} 127.0.0.1`, '--no-proxy-server'],
  })
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
    locale: ZH_BROWSER_LOCALE,
  })
  const tripwire = watchConsole(page)
  const sockets: WebSocket[] = []
  page.on('websocket', (socket) => { sockets.push(socket) })
  try {
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('#root', { timeout: 30_000 })
    await page.getByRole('dialog', { name: WELCOME_NOTICE_COPY.zh.title }).waitFor({ timeout: 15_000 })
    expect(await page.evaluate(() => globalThis.isSecureContext)).toBe(false)
    await expect.poll(() => sockets.length, { timeout: 15_000 }).toBe(2)
    await page.waitForTimeout(2_000)
    expect(sockets.every(socket => !socket.isClosed())).toBe(true)
    expect(tripwire.warnings).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
  } finally {
    await browser.close()
    await scaffold.close()
  }
}, 120_000)
