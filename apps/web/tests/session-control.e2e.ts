// Web e2e scenario: archive/restore and the global attention projection under
// the shipped Host, client runtime, and Workspace browser. The session fixture
// is a closed recorded history; the completed background job is registered by
// the real job registry, so neither path relies on DOM-derived state.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Browser, Locator, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  fixtureUserPrompts, launchWebScaffold, seedSession, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/session-control', import.meta.url))
// The same closed session that owns the assembled background-job scenario:
// its resumed Agent composes the shipped `bash` background-job provider.
const SEED = fileURLToPath(new URL('./snapshots/fresh-round-trip/session.jsonl', import.meta.url))
const QUESTION_FIXTURE = fileURLToPath(new URL('./snapshots/question-composer/session.jsonl', import.meta.url))
const ARCHIVE_EXPECTED = join(SNAPSHOT_DIR, 'archive-undo.expected.md')
const ATTENTION_EXPECTED = join(SNAPSHOT_DIR, 'attention-navigation.expected.md')
const MODE = webSnapshotMode()
const SESSION_ID = SessionId('session-control-web-e2e')
const QUESTION_PROMPT = 'Use the ask_user_question tool to ask me exactly one multi-select question with id "color", question "Which color do you prefer?", header "Pick one", and two options: label "Blue" with description "A cool recessive hue that reads as calm and trustworthy in long reading sessions and dense dashboards.", and label "Green" with description "A restful mid-spectrum hue with the highest perceived brightness, easiest on the eye over long sessions." Set multi_select to true. After I answer, reply with the single word DONE and stop.'

/** Move through a hover-only row action without treating visibility as a DOM-state authority. */
async function chooseRowAction(row: Locator, label: string): Promise<void> {
  const button = row.getByRole('button', { name: label })
  await expect.poll(async () => {
    await row.hover()
    return await button.isVisible()
  }, { timeout: 10_000 }).toBe(true)
  await button.click()
}

describe.skipIf(MODE === 'record')('web e2e: session archive restore and attention navigation', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let workspaceTitle: string

  /** The materialized member row, after expanding its real Workspace account. */
  async function memberRow(): Promise<Locator> {
    const group = page.locator('[role="treeitem"]').filter({ hasText: workspaceTitle }).first()
    const section = group.locator('xpath=ancestor::*[contains(@class, "groupSection")][1]')
    await expect.poll(async () => {
      if (await group.getAttribute('aria-expanded') !== 'true') await group.click()
      return await section.locator('[role="treeitem"]').count()
    }, { timeout: 10_000 }).toBeGreaterThanOrEqual(2)
    const row = section.locator('[role="treeitem"]').nth(1)
    await row.waitFor({ timeout: 10_000 })
    return row
  }

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, await readFile(SEED, 'utf8'), SESSION_ID)
    const workspace = await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd)
    await workspace.attachSession(SESSION_ID)
    workspaceTitle = workspace.title
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    // The shipped guided-onboarding finale may be present on a fresh profile;
    // close it through its user action before exercising the sidebar.
    const onboarding = page.getByRole('button', { name: 'Start first task' })
    if (await onboarding.count() > 0) await onboarding.click()
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('archives and restores immediately through Undo', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-session-control-archive'))
    const row = await memberRow()
    const title = await row.locator('[class*="title"]').innerText()
    await chooseRowAction(row, `Session actions for ${title}`)
    await page.getByRole('menuitem', { name: 'Archive session' }).click()
    await expect.poll(() => [...scaffold.ctx.workspaceRegistry.archivedSessionIds])
      .toEqual([SESSION_ID])
    await page.getByRole('status').getByText('Session archived').waitFor({ timeout: 10_000 })
    const archive = (await captureStableAria(page, '[class*="frame"]', scaffold.workspaceCwd))
      .replaceAll(workspaceTitle, '<workspace>')
    await compareOrRefreshGolden(ARCHIVE_EXPECTED, archive, MODE)
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => [...scaffold.ctx.workspaceRegistry.archivedSessionIds]).toEqual([])
    await expect.poll(() => page.getByText(title, { exact: true }).count()).toBeGreaterThanOrEqual(1)

    // Exercise the durable archived projection too: Undo is deliberately
    // immediate, while Restore remains available after the toast is gone.
    const restoredRow = await memberRow()
    await chooseRowAction(restoredRow, `Session actions for ${title}`)
    await page.getByRole('menuitem', { name: 'Archive session' }).click()
    await expect.poll(() => [...scaffold.ctx.workspaceRegistry.archivedSessionIds])
      .toEqual([SESSION_ID])
    await page.getByRole('button', { name: 'View options' }).click()
    await page.getByRole('menuitem', { name: 'Archived' }).click()
    const archived = page.getByRole('tree', { name: 'Archived' })
    const archivedRow = archived.getByRole('treeitem').filter({ hasText: title })
    await archivedRow.waitFor({ timeout: 10_000 })
    await chooseRowAction(archivedRow, `Session actions for ${title}`)
    await page.getByRole('menuitem', { name: 'Restore session' }).click()
    await expect.poll(() => [...scaffold.ctx.workspaceRegistry.archivedSessionIds]).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
  }, 90_000)

})

// A pending user question is a stable, real Host server-request. It avoids
// manufacturing a sidebar state and proves that the global projection follows
// the authoritative question event through the assembled browser application.
describe.skipIf(MODE === 'record')('web e2e: attention navigation', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ replayFixture: QUESTION_FIXTURE, paceMs: 15 })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    // Without a registered workspace the coordinator begins at its workspace
    // step. Skip that optional step, finish the terminal task step, then use
    // the ordinary picker route below so this journey owns its workspace.
    const skipWorkspace = page.getByRole('button', { name: 'Skip for now' })
    if (await skipWorkspace.count() > 0) await skipWorkspace.click()
    const onboarding = page.getByRole('button', { name: 'Start first task' })
    if (await onboarding.count() > 0) await onboarding.click()
    await connectFreshWorkspace(page, scaffold.workspaceCwd, 'attention-workspace')
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('navigates a pending question from attention and marks its collapsed workspace', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-session-control-attention'))
    expect(fixtureUserPrompts(await readFile(QUESTION_FIXTURE, 'utf8'))).toEqual([QUESTION_PROMPT])
    const input = page.locator('textarea').first()
    await input.fill(QUESTION_PROMPT)
    await input.press('Enter')
    const composer = page.locator('[data-question-key]')
    await composer.waitFor({ timeout: 30_000 })

    const group = page.getByRole('treeitem').filter({ hasText: 'attention-workspace' }).first()
    await group.waitFor({ timeout: 10_000 })
    if (await group.getAttribute('aria-expanded') === 'true') await group.click()
    await expect.poll(() => group.locator('[data-state="warning"]').count(), { timeout: 10_000 }).toBe(1)

    await page.getByRole('button', { name: 'View options' }).click()
    await page.getByRole('menuitem', { name: 'Needs attention' }).click()
    const attention = page.getByRole('tree', { name: 'Needs attention' })
    const attentionRow = attention.getByRole('treeitem').first()
    await attentionRow.click()
    await expect.poll(() => attentionRow.getAttribute('aria-selected')).toBe('true')
    await expect.poll(() => composer.count()).toBe(1)
    const snapshot = await captureStableAria(page, '[class*="frame"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(ATTENTION_EXPECTED, snapshot, MODE)
    // The fixture has one completion turn after the stable pending state.
    // Resolve it only after the navigation capture, so replay integrity proves
    // the full real interaction without erasing the attention condition.
    await composer.getByRole('checkbox', { name: 'Blue' }).click()
    const custom = composer.getByRole('textbox')
    await custom.fill('Include accessibility notes')
    await custom.press('Enter')
    await page.getByText('DONE', { exact: true }).waitFor({ timeout: 15_000 })
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 90_000)

  it('keeps its snapshot inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['archive-undo.expected.md', 'attention-navigation.expected.md'])
  })
})
