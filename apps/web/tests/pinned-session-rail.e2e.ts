// Web e2e scenario: a real Session is pinned through its row menu, then
// remains reachable after the sidebar settles into its compact rail.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Locator, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, seedSession, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/pinned-session-rail', import.meta.url))
const FIXTURE = fileURLToPath(new URL('./snapshots/pwsh-terminal/seed.jsonl', import.meta.url))
const RAIL_EXPECTED = join(SNAPSHOT_DIR, 'rail.expected.md')
const SESSION_ID = 'pinned-session-rail-web-e2e'
const MODE = webSnapshotMode()

describe('web e2e: pinned session in collapsed sidebar rail', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  /** Reveal and activate a hover-only row action. */
  async function clickHoverAction(row: Locator, name: string): Promise<void> {
    const button = row.getByRole('button', { name })
    await expect.poll(async () => {
      await row.hover()
      return await button.isVisible()
    }, { timeout: 10_000 }).toBe(true)
    await button.click()
  }

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, await readFile(FIXTURE, 'utf8'), SESSION_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })

    const skipOnboarding = page.getByRole('button', { name: 'Skip for now' })
    await skipOnboarding.waitFor({ state: 'visible', timeout: 15_000 })
    await skipOnboarding.click()
    await skipOnboarding.waitFor({ state: 'detached', timeout: 15_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it.skipIf(MODE === 'record')('opens a pinned Session from the 36px rail icon without expanding the sidebar', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-pinned-session-rail'))
    const ungrouped = page.getByText('Ungrouped', { exact: true })
    await ungrouped.click()
    const sessionRow = page.locator('[role="treeitem"]')
      .filter({ has: page.locator('button[aria-label^="Session actions for "]') })
      .first()
    await sessionRow.waitFor({ timeout: 10_000 })
    const actions = sessionRow.locator('button[aria-label^="Session actions for "]')
    const actionsName = await actions.getAttribute('aria-label')
    if (actionsName === null) throw new Error('seeded Session row has no actions label')
    const title = actionsName.slice('Session actions for '.length)
    await clickHoverAction(sessionRow, actionsName)
    await page.getByRole('menuitem', { name: 'Pin session' }).click()
    await expect.poll(() => [...scaffold.ctx.workspaceRegistry.pinnedSessionIds])
      .toEqual([SessionId(SESSION_ID)])
    await page.getByText('Pinned', { exact: true }).waitFor({ timeout: 10_000 })

    const frame = page.locator('[class*="frame"]')
    await page.getByRole('button', { name: 'Collapse sidebar' }).click()
    await expect.poll(() => frame.getAttribute('data-sidebar-collapsed'), { timeout: 10_000 }).toBe('true')

    const pin = page.getByRole('button', { name: `Open pinned session: ${title}` })
    await pin.waitFor({ timeout: 10_000 })
    expect(await pin.evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      return { width: Math.round(bounds.width), height: Math.round(bounds.height) }
    })).toEqual({ width: 36, height: 36 })
    const snapshot = (await captureStableAria(page, '[class*="frame"]', scaffold.workspaceCwd))
      .split(title).join('{{session}}')
    await compareOrRefreshGolden(RAIL_EXPECTED, snapshot, MODE)

    // Rail pins reuse the standard Session hover card and rename from its title.
    await pin.hover()
    const renameTitle = page.getByRole('button', { name: 'Rename session' })
    await renameTitle.waitFor({ timeout: 10_000 })
    expect(await renameTitle.textContent()).toContain(title)
    await renameTitle.click()
    const renamedTitle = `${title} renamed`
    const titleInput = page.getByRole('textbox', { name: 'Session name' })
    expect(await titleInput.evaluate((element) => {
      const style = getComputedStyle(element)
      return { fontSize: style.fontSize, lineHeight: style.lineHeight }
    })).toEqual({ fontSize: '14px', lineHeight: '20px' })
    await titleInput.fill(renamedTitle)
    await titleInput.press('Enter')
    const renamedPin = page.getByRole('button', { name: `Open pinned session: ${renamedTitle}` })
    await renamedPin.waitFor({ timeout: 10_000 })

    await renamedPin.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Unpin session' }).waitFor({ state: 'visible', timeout: 10_000 })
    await page.getByRole('menuitem', { name: 'Rename' }).waitFor({ state: 'visible', timeout: 10_000 })
    await page.getByRole('menuitem', { name: 'Fork session' }).waitFor({ state: 'visible', timeout: 10_000 })
    await page.getByRole('menuitem', { name: 'Move session…' }).waitFor({ state: 'visible', timeout: 10_000 })
    await page.getByRole('menuitem', { name: 'Archive session' }).waitFor({ state: 'visible', timeout: 10_000 })
    await page.keyboard.press('Escape')

    await renamedPin.click({ noWaitAfter: true })
    await expect.poll(() => renamedPin.getAttribute('aria-current'), { timeout: 10_000 }).toBe('page')
    expect(await frame.getAttribute('data-sidebar-collapsed')).toBe('true')
    expect(tripwire.pageErrors).toEqual([])
  }, 90_000)

  it.skipIf(MODE === 'record')('keeps the snapshot inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['.gitkeep', 'rail.expected.md'])
  })
})
