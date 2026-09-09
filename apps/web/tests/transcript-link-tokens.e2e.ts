import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { createMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-title'
import {
  assertFixtureInventory,
  compareOrRefreshGolden,
  launchWebScaffold,
  seedSession,
  watchConsole,
  webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/transcript-link-tokens', import.meta.url))
const UI_EXPECTED = fileURLToPath(new URL('./snapshots/transcript-link-tokens/ui.expected.md', import.meta.url))
const MODE = webSnapshotMode()
const SEED_ID = 'transcript-link-tokens-web-e2e'
const DONE = 'LINK_TOKENS_DONE'
const TEXT = '[Example documentation](https://example.invalid/docs) [Download](https://example.invalid/report.pdf) [Settings](https://example.invalid/settings.yaml)'

/** Build a closed conversation with identical links from the user and assistant. */
function markdownFixture(): string {
  const session = Session.create(SessionId('transcript-link-tokens-source'))
  const eventTimeOrigin = new Date().setHours(12, 0, 0, 0)
  session.append('turn/start', { turn: 1 })
  const user = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: TEXT }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('session/title', {
    title: 'Link tokens',
    messageSeqs: [user.seq],
    source: { kind: 'fallback' },
  })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createMessage({
      role: 'assistant',
      content: [{
        type: 'text',
        text: TEXT + '\n\n' + DONE,
      }],
      source: { kind: 'model', provider: 'fixture', model: 'fixture' },
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

  return [
    JSON.stringify({
      type: 'session',
      version: SESSION_FORMAT_VERSION,
      id: '{{sessionId}}',
      createdAt: 0,
      cwd: '{{cwd}}',
    }),
    ...session.events.map(event => JSON.stringify({
      ...event,
      time: eventTimeOrigin + event.seq * 1_000,
    })),
    '',
  ].join('\n')
}

describe('web e2e: transcript link tokens', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, markdownFixture(), SEED_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.route('https://example.invalid/**', route => route.abort())
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it.skipIf(MODE === 'record')('shows website and file tokens in both message directions', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-transcript-link-tokens'))
    const skip = page.getByRole('button', { name: 'Skip for now' })
    await skip.waitFor({ state: 'visible', timeout: 15_000 })
    await skip.click()
    const sessionRow = page.locator(`[data-drag-id="s:${SEED_ID}"]`)
    await sessionRow.waitFor({ timeout: 15_000 })
    await sessionRow.click()
    await expect.poll(() => page.getByText(DONE, { exact: true }).count(), { timeout: 15_000 }).toBe(1)

    const tokens = page.locator('[data-link-token]')
    await expect.poll(() => tokens.count(), { timeout: 15_000 }).toBe(6)
    const projection = await tokens.evaluateAll(elements => elements.map(el =>
      `${el.getAttribute('data-link-token')} | ${el.textContent} | ${el.getAttribute('href')}`).join('\n'))
    await compareOrRefreshGolden(UI_EXPECTED, projection, MODE)
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      const spills = await tokens.evaluateAll(elements => elements.map(el =>
        el.getBoundingClientRect().width > el.parentElement!.getBoundingClientRect().width + 1))
      expect(spills).toEqual(Array(6).fill(false))
    }
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['ui.expected.md'])
  }, 60_000)
})
