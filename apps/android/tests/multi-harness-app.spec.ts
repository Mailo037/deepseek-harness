// @vitest-environment jsdom
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { SavedHarness } from '../src/HarnessStorage.ts'
import type { SessionTarget } from '../src/NotificationService.ts'

const mocks = vi.hoisted(() => ({
  open: (_target: SessionTarget) => {},
  start: vi.fn(), stop: vi.fn(), select: vi.fn(),
}))
const harness = (id: string): SavedHarness => ({ id, name: id, config: {
  serverUrl: `http://${id}.local`, endpoints: [`http://${id}.local`], deviceId: 'same-id', deviceSecret: id, deviceName: 'Phone', accessToken: id,
} })
vi.mock('../src/HarnessStorage.ts', () => ({
  loadHarnesses: async () => [harness('one'), harness('two')],
  activeHarnessId: async () => 'one',
  readHarness: async (id: string) => harness(id),
  selectHarness: mocks.select,
}))
vi.mock('../src/NotificationService.ts', () => ({
  startNotificationService: mocks.start,
  stopNotificationService: mocks.stop,
  getLaunchSession: async () => undefined,
  onOpenSession: async (cb: typeof mocks.open) => { mocks.open = cb; return { remove() {} } },
}))
vi.mock('../src/systemBars.ts', () => ({ initSystemBars: () => () => {} }))
vi.mock('../src/AppUpdate.ts', () => ({ checkForAppUpdate: async () => {} }))
vi.mock('../src/ScanScreen.tsx', () => ({ PairingScreen: () => createElement('div', {}, 'Pair another Harness') }))
vi.mock('../src/ConnectedScreen.tsx', () => ({ ConnectedScreen: (props: { harnessId: string; sessionTarget?: SessionTarget; onSwitch: () => void }) =>
  createElement('div', {}, `${props.harnessId}:${props.sessionTarget?.sessionId ?? 'home'}`, createElement('button', { onClick: props.onSwitch }, 'Harnesses')),
}))
const { App } = await import('../src/App.tsx')
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

it('starts both channels and routes background notifications to the owning Harness', async () => {
  mocks.start.mockResolvedValue(undefined)
  render(createElement(App))
  await screen.findByText('one:home')
  await waitFor(() => { expect(mocks.start).toHaveBeenCalledTimes(2) })
  fireEvent.click(screen.getByRole('button', { name: 'Harnesses' }))
  fireEvent.click(screen.getByRole('button', { name: 'two Open' }))
  await screen.findByText('two:home')
  expect(mocks.stop).not.toHaveBeenCalled()
  expect(mocks.start).toHaveBeenCalledTimes(2)
  await act(async () => { mocks.open({ harnessId: 'one', sessionId: 'finished-chat' }) })
  await screen.findByText('one:finished-chat')
  expect(mocks.select).toHaveBeenLastCalledWith('one')
})
