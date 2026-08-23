// Web e2e scenarios for the global keyboard shortcuts: Ctrl+B toggles the
// sidebar column, Ctrl+Shift+S starts a New Session. Zero model calls — both
// chords drive the same client services as the sidebar buttons, so there is
// no fixture. The fresh scaffold has no Workspace, so New Session mints an
// ungrouped blank Session (the client `startSession` fallback) and the host
// session list grows by exactly one.
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

describe('web e2e: global keyboard shortcuts', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('toggles the sidebar with Ctrl+B', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-shortcuts-sidebar'))
    const frame = page.locator('[class*="frame"]')
    // Desktop viewport starts expanded: the collapsed marker is absent.
    expect(await frame.getAttribute('data-sidebar-collapsed')).toBeNull()

    await page.keyboard.press('Control+b')
    await expect.poll(() => frame.getAttribute('data-sidebar-collapsed'), { timeout: 10_000 }).toBe('true')

    await page.keyboard.press('Control+b')
    await expect.poll(() => frame.getAttribute('data-sidebar-collapsed'), { timeout: 10_000 }).toBeNull()
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('starts a new Session with Ctrl+Shift+S', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-shortcuts-new-session'))
    // A fresh world has no Workspace, so the composer starts as the locked
    // Workspace-trigger (read-only "Choose workspace" textbox). New Session
    // mints an ungrouped blank Session and opens it, which unlocks the live
    // composer — the same transition connectFreshWorkspace drives by pointer.
    const locked = page.getByRole('textbox', { name: 'Choose workspace' })
    await locked.waitFor({ timeout: 15_000 })

    await page.keyboard.press('Control+Shift+s')
    await page.locator('textarea:enabled[placeholder="Describe what you want to build"]')
      .waitFor({ timeout: 15_000 })
    await expect.poll(() => locked.count(), { timeout: 15_000 }).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)
})
