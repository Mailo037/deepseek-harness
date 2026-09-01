/** Diagnostic: run the smoke runner's SCREEN probe in a poll loop. */

import { argOf } from './args.mjs'

const port = Number(argOf('--cdp-port', '9223'))
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
console.log('targets:', targets.map(target => ({ type: target.type, url: target.url })))
const page = targets.find(target => target.type === 'page' && target.url.includes('localhost')) ?? targets[0]
console.log('picked:', page.url)
const ws = new WebSocket(page.webSocketDebuggerUrl)
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
const evaluate = async expression => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
  if (result.exceptionDetails !== undefined) return `EXCEPTION: ${JSON.stringify(result.exceptionDetails).slice(0, 200)}`
  return result.result.value
}

for (let i = 0; i < 4; i++) {
  const simple = await evaluate(`document.querySelector('.option-button') !== null`)
  const screen = await evaluate(`(() => {
    if (document.querySelector('.steps') !== null) return 'connecting'
    if (document.querySelector('.iframe-bar') !== null) return 'connected'
    if (document.querySelector('.option-button') !== null) return 'pairing'
    return 'unknown: ' + document.body.innerText.slice(0, 60)
  })()`)
  console.log(`poll ${i}: simple=${JSON.stringify(simple)} screen=${JSON.stringify(screen)}`)
  await new Promise(resolve => setTimeout(resolve, 500))
}
ws.close()
