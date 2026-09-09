/** Keyless cold-session replay keeps paged work behind its duration row. */
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, seedSession,
  watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage } from './support.ts'

const ID = 'history-turn-prefetch'
const EXPECTED = fileURLToPath(new URL('./snapshots/history-turn-prefetch/ui.expected.md', import.meta.url))

function seed(): string {
  const lines = [JSON.stringify({
    type: 'session', version: 0, id: '{{sessionId}}', createdAt: 1784974100000, cwd: '{{cwd}}/workspace',
  })]
  let seq = 0
  const append = (event: Record<string, unknown>): void => {
    lines.push(JSON.stringify({ ...event, seq, time: 1784974100000 + seq++ * 1000 }))
  }
  append({ type: 'session/title', data: { title: 'History prefetch', messageSeqs: [], source: { kind: 'fallback' } } })
  append({ type: 'turn/start', data: { turn: 1 } })
  append({ type: 'user/message', surfaceOp: 'append', data: {
    id: '00000000-0000-4000-8000-000000000000', role: 'user',
    content: [{ type: 'text', text: 'Original prompt' }], source: { kind: 'user' },
  } })
  for (let step = 1; step <= 60; step++) {
    append({ type: 'step/start', data: { turn: 1, step } })
    append({ type: 'assistant/message', surfaceOp: 'append', sourceEventSeqs: [], data: {
      turn: 1, step, message: {
        id: `00000000-0000-4000-8000-${String(step).padStart(12, '0')}`, role: 'assistant',
        content: [{ type: 'text', text: step === 60 ? 'Final answer' : `Work detail ${step}` }],
        source: { kind: 'model', provider: 'snapshot', model: 'snapshot-replier' },
      },
    } })
    append({ type: 'step/end', data: { turn: 1, step } })
  }
  append({ type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  return `${lines.join('\n')}\n`
}

describe('web e2e: collapsed history prefetch', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let errors: ReturnType<typeof watchConsole>
  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    scaffold.workspaceCwd = scaffold.workspaceCwd.replaceAll('\\', '/')
    await seedSession(scaffold, seed(), ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    errors = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    const skip = page.getByRole('button', { name: 'Skip for now' })
    await skip.waitFor({ state: 'visible', timeout: 15_000 })
    await skip.click()
    await page.locator(`[data-drag-id="s:${ID}"]`).click()
  }, 120_000)
  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('backfills multiple pages without exposing intermediate work', async () => {
    onTestFailed(async () => {
      console.log(await page.locator('[class*="centerCol"]').innerText())
      console.log(errors.pageErrors, errors.warnings)
    })
    await page.getByText('Final answer', { exact: true }).waitFor()
    await page.locator('[data-turn-summary]').waitFor()
    expect(await page.getByText('Work detail 59', { exact: true }).count()).toBe(0)
    await page.getByText('Original prompt', { exact: true }).waitFor({ timeout: 30_000 })
    expect(await page.locator('[data-turn-summary]').count()).toBe(1)
    expect(await page.getByText('Work detail 1', { exact: true }).count()).toBe(0)
    const summary = page.locator('[data-turn-summary] > button')
    expect(await summary.getAttribute('aria-expanded')).toBe('false')
    const snapshot = (await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd))
      .split(ID).join('{{seededId}}')
    await compareOrRefreshGolden(EXPECTED, snapshot, webSnapshotMode())
    await summary.click()
    await page.getByText('Work detail 1', { exact: true }).waitFor()
    await page.getByText('Work detail 59', { exact: true }).waitFor()
    expect(errors.pageErrors).toEqual([])
    expect(errors.warnings).toEqual([])
  }, 60_000)
})
