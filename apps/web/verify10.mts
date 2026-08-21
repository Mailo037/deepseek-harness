import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
await page.goto('http://127.0.0.1:3080/', { waitUntil: 'load', timeout: 45000 })
await page.waitForSelector('#root > *', { timeout: 20000 })
await page.waitForTimeout(3000)

const treeitems = page.locator('[role="treeitem"]')
const count = await treeitems.count()
for (let i = 0; i < count; i++) {
  const text = (await treeitems.nth(i).textContent()) ?? ''
  if (text.includes('Toolaufrufe') || text.includes('ausblenden')) { await treeitems.nth(i).click(); break }
}
await page.waitForTimeout(6000)

const state = await page.evaluate(`(() => {
  const folds = [...document.querySelectorAll('[data-turn-summary]')]
  const groups = [...document.querySelectorAll('[data-tool-group]')]
  const toggleStyle = groups.length > 0 && groups[0].querySelector(':scope > button') !== null
    ? getComputedStyle(groups[0].querySelector(':scope > button'))
    : null
  return {
    folds: folds.map(f => ({
      label: f.querySelector(':scope > button span')?.textContent ?? null,
      open: f.querySelector(':scope > button')?.getAttribute('aria-expanded'),
    })),
    groupCount: groups.length,
    groupHeaders: groups.slice(0, 5).map(g => g.querySelector(':scope > button span')?.textContent ?? null),
    toggleBorderStyle: toggleStyle?.borderStyle ?? null,
    toggleBorderColor: toggleStyle?.borderTopColor ?? null,
  }
})()`)
console.log(JSON.stringify(state, null, 2))

// Interact with the first fold if present.
const foldBtn = page.locator('[data-turn-summary] > button').first()
if (await foldBtn.count() > 0) {
  await foldBtn.click()
  await page.waitForTimeout(500)
  console.log('after unfold — aria:', await foldBtn.getAttribute('aria-expanded'),
    '| tool seats:', await page.locator('[data-chat-call-id]').count())
  await foldBtn.click()
  await page.waitForTimeout(400)
  console.log('after refold — aria:', await foldBtn.getAttribute('aria-expanded'),
    '| tool seats:', await page.locator('[data-chat-call-id]').count())
}
await browser.close()
