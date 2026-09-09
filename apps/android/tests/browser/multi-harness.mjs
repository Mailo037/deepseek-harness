/** Built Android shell smoke with two remote GUI origins and a simulated native bridge. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve, extname } from 'node:path'
import { chromium } from 'playwright'

const dist = fileURLToPath(new URL('../../dist/', import.meta.url))
const server = createServer(async (req, res) => {
  const path = resolve(dist, `.${new URL(req.url, 'http://localhost').pathname === '/' ? '/index.html' : new URL(req.url, 'http://localhost').pathname}`)
  if (!path.startsWith(dist)) { res.writeHead(403).end(); return }
  try {
    const bytes = await readFile(path)
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[extname(path)] ?? 'application/octet-stream')
    res.end(bytes)
  } catch { res.writeHead(404).end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    const seed = (key, value) => localStorage.setItem(`CapacitorStorage.${key}`, value)
    if (!localStorage.getItem('CapacitorStorage.harnesses')) {
      seed('harnesses', JSON.stringify(['one', 'two']))
      seed('activeHarness', 'one')
      for (const id of ['one', 'two']) {
        seed(`harness.${id}`, JSON.stringify({ id, name: id === 'one' ? 'Home PC' : 'Work PC', config: {
          serverUrl: `http://${id}.local`, endpoints: [`http://${id}.local`], deviceId: 'same-device', deviceSecret: `secret-${id}`, deviceName: 'Phone', accessToken: '',
        } }))
        seed(`harness.${id}.token`, `token-${id}`)
      }
    }
    const listeners = new Map()
    window.testBridge = { started: [], stopped: [], open: target => { for (const { event, callback } of listeners.values()) if (event === 'openSession') callback(target) } }
    window.Capacitor = {
      PluginHeaders: [{ name: 'DeviceChannel', methods: [
        ...['start', 'stop', 'getChannelState', 'getLaunchSession', 'getNetworkState', 'setNotificationPermission', 'removeListener'].map(name => ({ name, rtype: 'promise' })),
        { name: 'addListener', rtype: 'callback' },
      ] }],
      nativePromise: async (_plugin, method, options) => {
        if (method === 'start') window.testBridge.started.push(options.harnessId)
        if (method === 'stop') window.testBridge.stopped.push(options.harnessId)
        if (method === 'removeListener') listeners.delete(options.callbackId)
        if (method === 'getChannelState') return { harnessId: options.harnessId, connected: false }
        return {}
      },
      nativeCallback: (_plugin, _method, options, callback) => {
        const id = crypto.randomUUID()
        listeners.set(id, { event: options.eventName, callback })
        return id
      },
    }
  })
  await page.route(/^http:\/\/(one|two)\.local\//, route => route.fulfill({
    contentType: 'text/html', body: `<!doctype html><html><body><h1>Remote GUI</h1><p id="session">Home</p><script>
      addEventListener('message', event => {
        if(event.data.type === 'dsh/client-shell-context') parent.postMessage({type:'dsh/client-connection-state',version:1,state:'connected'},event.origin);
        if(event.data.type === 'dsh/open-session') document.getElementById('session').textContent=event.data.sessionId;
      });</script></body></html>`,
  }))
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.getByRole('button', { name: 'Harnesses', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Harnesses' })
  await dialog.waitFor()
  const snapshot = await dialog.ariaSnapshot()
  const golden = new URL('./multi-harness.expected.txt', import.meta.url)
  if (process.argv.includes('--update')) await writeFile(golden, `${snapshot}\n`)
  else assert.equal(`${snapshot}\n`, await readFile(golden, 'utf8'))
  const artifacts = fileURLToPath(new URL('../../../../.artifacts/android-multi/', import.meta.url))
  await mkdir(artifacts, { recursive: true })
  await page.screenshot({ path: resolve(artifacts, 'chooser.png') })
  await dialog.getByRole('button', { name: 'Work PC Open' }).click()
  await page.waitForFunction(() => document.querySelector('iframe')?.src.startsWith('http://two.local/'))
  await page.evaluate(() => window.testBridge.open({ harnessId: 'one', sessionId: 'finished-chat' }))
  await page.waitForFunction(() => document.querySelector('iframe')?.src.startsWith('http://one.local/'))
  await page.frameLocator('iframe').getByText('finished-chat', { exact: true }).waitFor()
  assert.deepEqual(await page.evaluate(() => [...new Set(window.testBridge.started)].sort()), ['one', 'two'])
  assert.deepEqual(await page.evaluate(() => window.testBridge.stopped), [])
  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme })
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 })
      const bar = page.locator('.iframe-bar')
      assert.equal(await bar.evaluate(element => element.scrollWidth <= element.clientWidth), true)
      assert.equal(await page.locator('.harness-switch-name').textContent(), 'Home PC')
      await bar.screenshot({ path: resolve(artifacts, `topbar-${colorScheme}-${width}.png`) })
    }
  }
  assert.deepEqual(errors, [])
  console.log('PASS: built shell switches Harnesses, retains background channels, and routes notification chats.')
} finally {
  await browser.close()
  await new Promise(resolve => server.close(resolve))
}
