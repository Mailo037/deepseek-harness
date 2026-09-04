// Cold replay through the real Web composition keeps final-step reasoning in
// the preceding work group while the answer remains independently visible.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, seedSession, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const FIXTURE = fileURLToPath(new URL('./snapshots/question-composer/session.jsonl', import.meta.url))

describe('web: reasoning stays inside the tool group', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, await readFile(FIXTURE, 'utf8'), 'tool-group-reasoning-e2e')
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    page.setDefaultTimeout(10_000)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    const workspace = page.locator('[role="treeitem"]').first()
    await workspace.waitFor({ timeout: 30_000 })
    await page.getByRole('dialog', { name: 'Choose a workspace', exact: true })
      .getByRole('button', { name: 'Skip for now', exact: true }).click()
    if (await workspace.getAttribute('aria-expanded') === 'false') await workspace.click()
    const session = page.getByText('Use the ask_user_question tool to', { exact: true })
    await session.waitFor({ timeout: 10_000 })
    await session.click()
    await page.getByText('DONE', { exact: true }).waitFor({ timeout: 15_000 })
  })

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('folds both Think rows together without hiding or duplicating the answer', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-tool-group-reasoning'))
    const group = page.locator('[data-tool-group]')
    const toggle = group.locator(':scope > button')
    await toggle.click()
    await expect.poll(() => group.locator('[data-variant="think"]').count()).toBe(2)
    const reasoning = page.locator('[data-variant="think"]')
    expect(await reasoning.count()).toBe(2)
    expect(await group.getByText('DONE', { exact: true }).count()).toBe(0)
    const summary = await reasoning.locator('button').allTextContents()
    expect(summary.map(text => text.trim())).toMatchInlineSnapshot(`
      [
        "ThinkThe user wants me to use the ask_user_question tool with specific parameters. Let me do exactly that.",
        "ThinkThe user answered \"Blue\". I should now reply with the single word DONE and stop.",
      ]
    `)
    await toggle.click()
    expect(await reasoning.count()).toBe(0)
    expect(await page.getByText('DONE', { exact: true }).isVisible()).toBe(true)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })
})
