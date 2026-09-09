// @vitest-environment jsdom
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ConnectedScreen } from '../src/ConnectedScreen.tsx'

const bridge = vi.hoisted(() => ({
  network: (_state: { connected: boolean }) => {},
  channel: (_state: { harnessId: string; connected: boolean; serverUrl?: string; accessToken?: string }) => {},
}))
vi.mock('@capacitor/network', () => ({ Network: {
  getStatus: async () => ({ connected: true }),
  addListener: async (_name: string, cb: typeof bridge.network) => { bridge.network = cb; return { remove() {} } },
} }))
vi.mock('../src/NotificationService.ts', () => ({
  startNotificationService: async () => {},
  getChannelState: async () => ({ connected: false }),
  getLaunchSession: async () => 'notification-chat',
  isVpnActive: async () => false,
  onChannelState: async (cb: typeof bridge.channel) => { bridge.channel = cb; return { remove() {} } },
}))
vi.mock('../src/DeviceStorage.ts', () => ({
  guiUrlOf: (config: { serverUrl: string }, origin = config.serverUrl) => origin,
  persistAccessToken: async () => {},
  persistLastSuccessful: async () => {},
}))
vi.mock('../src/HarnessStorage.ts', () => ({ persistHarnessOrigin: vi.fn(), persistHarnessToken: vi.fn() }))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

const config = { serverUrl: 'http://pc.local', endpoints: ['http://pc.local'], accessToken: '', deviceId: 'd', deviceSecret: 's', deviceName: 'Phone' }

it('ignores another Harness channel before the visible GUI connects', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({}))
  const view = render(createElement(ConnectedScreen, { config, harnessId: 'one', onSwitch() {}, onDisconnect() {} }))
  await act(async () => {
    bridge.channel({ harnessId: 'two', connected: true, serverUrl: 'http://other.local', accessToken: 'other-token' })
  })
  expect(view.getByTitle('Harness Remote GUI').getAttribute('src')).toBe('http://pc.local')
  const { persistHarnessToken } = await import('../src/HarnessStorage.ts')
  expect(persistHarnessToken).not.toHaveBeenCalled()
})

it('keeps the loaded iframe across network loss and native endpoint changes', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({}))
  const view = render(createElement(ConnectedScreen, { config, harnessId: 'one', onSwitch() {}, sessionTarget: { sessionId: 'notification-chat' }, onDisconnect() {} }))
  const frame = view.getByTitle('Harness Remote GUI') as HTMLIFrameElement
  await act(async () => { fireEvent.load(frame) })
  await act(async () => { bridge.network({ connected: false }) })
  expect(view.getByTitle('Harness Remote GUI')).toBe(frame)
  await act(async () => {
    window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, origin: 'http://pc.local', data: { type: 'dsh/client-connection-state', version: 1, state: 'connected' } }))
    bridge.channel({ harnessId: 'one', connected: true, serverUrl: 'http://different.local' })
  })
  expect(frame.getAttribute('src')).toBe('http://pc.local')
  await act(async () => { bridge.network({ connected: true }) })
  expect(view.getByTitle('Harness Remote GUI')).toBe(frame)
})

it('holds notification navigation until the GUI confirms its connection, not just document load', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({}))
  const view = render(createElement(ConnectedScreen, { config, harnessId: 'one', onSwitch() {}, sessionTarget: { sessionId: 'notification-chat' }, onDisconnect() {} }))
  const frame = view.getByTitle('Harness Remote GUI') as HTMLIFrameElement
  const post = vi.spyOn(frame.contentWindow!, 'postMessage')
  await act(async () => { fireEvent.load(frame) })
  expect(post.mock.calls.some(([message]) => (message as { type?: string }).type === 'dsh/open-session')).toBe(false)
  await act(async () => {
    window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, origin: 'http://pc.local', data: { type: 'dsh/client-connection-state', version: 1, state: 'connected' } }))
  })
  await waitFor(() => { expect(post).toHaveBeenCalledWith({ type: 'dsh/open-session', version: 1, sessionId: 'notification-chat' }, 'http://pc.local') })
  view.rerender(createElement(ConnectedScreen, { config, harnessId: 'one', onSwitch() {}, sessionTarget: { sessionId: 'second-chat' }, onDisconnect() {} }))
  expect(post).toHaveBeenLastCalledWith({ type: 'dsh/open-session', version: 1, sessionId: 'second-chat' }, 'http://pc.local')
})
