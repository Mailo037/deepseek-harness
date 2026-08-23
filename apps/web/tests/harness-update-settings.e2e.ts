// Web e2e scenario: the About surface's optional AI-assisted Harness update
// flow. It stops before loading or starting a model, so the assembled custom
// controls and credit boundary are keyless and a stray stream fails loud.
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { join } from 'node:path'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/harness-update-settings', import.meta.url))
const CARD_EXPECTED = join(SNAPSHOT_DIR, 'card.expected.md')
const MODE = webSnapshotMode()

describe('web e2e: optional AI-assisted Harness updates', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd)
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'en-US' })
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    const onboarding = page.getByRole('button', { name: 'Start first task' })
    if (await onboarding.count() > 0) await onboarding.click()
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('defaults to the unofficial source and switches through custom controls without starting AI', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-harness-update-settings'))
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await dialog.getByRole('button', { name: 'About', exact: true }).click()

    const source = dialog.getByRole('combobox', { name: 'Update source' })
    await source.waitFor({ timeout: 10_000 })
    expect(await source.textContent()).toContain('Unofficial Harness')
    await dialog.getByText(/loading the model list uses no AI credits/i).waitFor()
    await dialog.getByRole('link', { name: 'Mailo037/deepseek-harness' }).waitFor()
    expect(await dialog.getByRole('button', { name: 'Load AI models' }).isEnabled()).toBe(true)

    const snapshot = await captureStableAria(
      page,
      '#harness-update-card',
      scaffold.workspaceCwd,
    )
    await compareOrRefreshGolden(CARD_EXPECTED, snapshot, MODE)

    await source.click()
    await page.getByRole('menuitem', { name: 'Official DeepSeek Harness' }).click()
    await dialog.getByRole('link', { name: 'deepseek-ai/deepseek-harness' }).waitFor()
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)

  it.skipIf(MODE === 'record')('keeps the fixture inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['card.expected.md'])
  })
})
