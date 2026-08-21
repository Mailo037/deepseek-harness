// Web e2e scenario: the phone-sized sidebar drawer. Below the drawer
// breakpoint a manual re-expand renders the sidebar as an overlay drawer
// instead of squeezing the conversation column: the center keeps its full
// width, a mask covers the rest, and clicking the mask closes the drawer.
// Zero model calls: pure client layout gestures, so there is no fixture.
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { saveFailureShot } from './support.ts'

/** Phone-portrait viewport, below the drawer breakpoint. */
const DRAWER_VIEWPORT = { width: 390, height: 844 }

describe('web e2e: phone-sized sidebar drawer', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: DRAWER_VIEWPORT, locale: 'en-US' })
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('expands as an overlay drawer over the full-width center and closes on the mask', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-sidebar-drawer'))
    const frame = page.locator('[class*="frame"]')
    // Below the auto-collapse breakpoint the phone starts at the compact rail.
    expect(await frame.getAttribute('data-sidebar-collapsed')).toBe('true')

    const centerWidth = (): Promise<number> => page.locator('[data-conversation-scroll]')
      .evaluate(el => el.getBoundingClientRect().width)
    const before = await centerWidth()

    await page.getByRole('button', { name: 'Open sidebar', exact: true }).click()
    expect(await frame.getAttribute('data-drawer-mode')).toBe('true')

    // The drawer overlays: the center column keeps its full rail width.
    expect(await centerWidth()).toBe(before)

    // The sidebar renders at the drawer width from the frame's left edge.
    const sidebarBox = await page.locator('[class*="sidebarCol"]').boundingBox()
    expect(sidebarBox).not.toBeNull()
    expect(sidebarBox!.x).toBe(0)
    expect(sidebarBox!.width).toBeGreaterThan(200)
    expect(sidebarBox!.width).toBeLessThanOrEqual(320)

    // The mask covers the conversation and closes the drawer on click.
    const frameBox = await frame.boundingBox()
    expect(frameBox).not.toBeNull()
    await page.mouse.click(frameBox!.x + frameBox!.width - 20, frameBox!.y + frameBox!.height / 2)
    expect(await frame.getAttribute('data-drawer-mode')).not.toBe('true')
    expect(await frame.getAttribute('data-sidebar-collapsed')).toBe('true')
    // ...and the center is still full width after the round trip.
    expect(await centerWidth()).toBe(before)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)
})
