// Quick verification of the mobile drawer + settings sheet against the LIVE
// GUI at 127.0.0.1:3080 (locale-agnostic selectors, no assertions library).
import { chromium } from 'playwright'

const baseUrl = 'http://127.0.0.1:3080'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })

try {
  await page.goto(baseUrl, { waitUntil: 'load' })
  await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })

  const frame = page.locator('[class*="frame"]')
  const collapsed = await frame.getAttribute('data-sidebar-collapsed')
  console.log('initial data-sidebar-collapsed:', collapsed)

  const centerWidth = () => page.locator('[data-conversation-scroll]')
    .evaluate(el => Math.round(el.getBoundingClientRect().width))
  const before = await centerWidth()
  console.log('center width before drawer:', before)

  // Rail toggle: the only button inside the logo row while collapsed.
  await page.locator('[class*="logoRow"] button').first().click()
  await page.waitForFunction(() => document.querySelector('[class*="frame"]')?.hasAttribute('data-drawer-mode'))
  console.log('drawer-mode after toggle:',
    await frame.getAttribute('data-drawer-mode'),
    '| center width with drawer open:', await centerWidth(),
    '| unchanged:', (await centerWidth()) === before)

  const sidebarBox = await page.locator('[class*="sidebarCol"]').boundingBox()
  console.log('drawer box:', sidebarBox ? `x=${Math.round(sidebarBox.x)} w=${Math.round(sidebarBox.width)}` : 'none')

  // Close via the mask.
  await page.locator('[class*="drawerBackdrop"]').click({ position: { x: 30, y: 300 } })
  await page.waitForFunction(() => !document.querySelector('[class*="frame"]')?.hasAttribute('data-drawer-mode'))
  console.log('after mask click, drawer-mode:',
    await frame.getAttribute('data-drawer-mode'),
    '| collapsed:', await frame.getAttribute('data-sidebar-collapsed'))

  // Re-open and open settings from the drawer foot.
  await page.locator('[class*="logoRow"] button').first().click()
  await page.waitForFunction(() => document.querySelector('[class*="frame"]')?.hasAttribute('data-drawer-mode'))
  await page.locator('[class*="settingsArea"] button').first().click()
  const dialog = page.locator('[role="dialog"]')
  await dialog.waitFor({ timeout: 10_000 })
  const panelBox = await dialog.boundingBox()
  console.log('settings panel box:', panelBox ? `${Math.round(panelBox.width)}x${Math.round(panelBox.height)}` : 'none')
  const navBox = await dialog.locator('[class*="nav"]').first().boundingBox()
  const contentBox = await dialog.locator('[class*="content"]').first().boundingBox()
  console.log('nav box:', navBox ? `w=${Math.round(navBox.width)} h=${Math.round(navBox.height)}` : 'none',
    '| content box top/bottom:', contentBox ? `${Math.round(contentBox.top)}/${Math.round(contentBox.bottom)}` : 'none',
    '| stacked:', navBox && contentBox ? contentBox.top >= navBox.bottom - 1 : 'n/a')
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'detached', timeout: 10_000 })
  console.log('settings closed via Escape; drawer still open:',
    await frame.getAttribute('data-drawer-mode'))
} catch (error) {
  console.error('VERIFY FAILED:', error)
  process.exitCode = 1
} finally {
  await browser.close()
}
