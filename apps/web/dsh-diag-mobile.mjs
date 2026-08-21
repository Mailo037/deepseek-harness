// Diagnostics for the live GUI drawer state.
import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
try {
  await page.goto('http://127.0.0.1:3080', { waitUntil: 'load' })
  await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  const frame = page.locator('[class*="frame"]')

  const diag = () => page.evaluate(() => {
    const frameEl = document.querySelector('[class*="frame"]')
    const center = frameEl?.querySelector('[class*="centerCol"]')
    const conv = document.querySelector('[data-conversation-scroll]')
    return {
      grid: frameEl ? getComputedStyle(frameEl).gridTemplateColumns : null,
      drawerMode: frameEl?.hasAttribute('data-drawer-mode') ?? false,
      collapsed: frameEl?.getAttribute('data-sidebar-collapsed') ?? null,
      centerWidth: center ? Math.round(center.getBoundingClientRect().width) : null,
      convWidth: conv ? Math.round(conv.getBoundingClientRect().width) : null,
      convCount: document.querySelectorAll('[data-conversation-scroll]').length,
    }
  })

  console.log('before toggle:', JSON.stringify(await diag()))
  await page.locator('[class*="logoRow"] button').first().click()
  await page.waitForFunction(() => document.querySelector('[class*="frame"]')?.hasAttribute('data-drawer-mode'))
  await page.waitForTimeout(500)
  console.log('after toggle:', JSON.stringify(await diag()))
} finally {
  await browser.close()
}
