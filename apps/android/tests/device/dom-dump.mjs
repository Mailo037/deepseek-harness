/** Diagnostic: dump the app WebView's visible text and DOM head via CDP. */

import { argOf } from './args.mjs'

const port = Number(argOf('--cdp-port', '9223'))
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const ws = new WebSocket(targets[0].webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.onopen = resolve
  ws.onerror = () => reject(new Error('CDP websocket failed'))
})
let nextId = 0
const pending = new Map()
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data)
  if (message.id !== undefined && pending.has(message.id)) {
    const resolve = pending.get(message.id)
    pending.delete(message.id)
    resolve(message.result)
  }
})
const send = (method, params = {}) => new Promise(resolve => {
  const id = ++nextId
  pending.set(id, resolve)
  ws.send(JSON.stringify({ id, method, params }))
})

const result = await send('Runtime.evaluate', {
  expression: `(() => ({
    text: document.body.innerText.slice(0, 400),
    html: document.body.innerHTML.slice(0, 600),
    classes: [...document.body.querySelectorAll('*')].slice(0, 30).map(el => el.className).filter(Boolean),
    theme: {
      darkAttribute: document.body.hasAttribute('data-ds-dark-theme'),
      darkMedia: matchMedia('(prefers-color-scheme: dark)').matches,
      foregroundToken: getComputedStyle(document.body).getPropertyValue('--dsw-alias-label-primary'),
      bodyColor: getComputedStyle(document.body).color,
      bodyBackground: getComputedStyle(document.body).backgroundColor,
    },
  }))()`,
  returnByValue: true,
})
console.log(JSON.stringify(result.result?.value, null, 1))
ws.close()
