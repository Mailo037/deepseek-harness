// @vitest-environment jsdom
/**
 * The Remote devices section's rendering rules: the guided Tailscale handoff
 * closes settings onto the conversation, pairing and device rows render their
 * live states, and secrets stay masked until revealed.
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { RemoteSettingsSection } from '../src/client/RemoteSettingsSection.tsx'
import type { RemoteSettingsSectionProps } from '../src/client/RemoteSettingsSection.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const PAIRING = {
  token: 'pair-token',
  expiresAt: new Date('2026-01-01T12:00:00Z').toISOString(),
  payload: '{"v":1,"endpoints":[],"token":"pair-token"}',
  qrDataUrl: 'data:image/png;base64,AAAA',
}

const MASK = '•'.repeat(16)

type SectionSpies = {
  close: ReturnType<typeof vi.fn>
  createPairing: ReturnType<typeof vi.fn>
  listDevices: ReturnType<typeof vi.fn>
  revokeDevice: ReturnType<typeof vi.fn>
  getAccessToken: ReturnType<typeof vi.fn>
  sendTailscaleSetup: ReturnType<typeof vi.fn>
}

function renderSection(overrides: Record<string, unknown> = {}): SectionSpies {
  const props = {
    t: (key: keyof typeof en) => en[key],
    close: vi.fn(),
    createPairing: vi.fn(() => Promise.resolve(PAIRING)),
    listDevices: vi.fn(() => Promise.resolve({ devices: [] })),
    revokeDevice: vi.fn(() => Promise.resolve({ revoked: true })),
    getAccessToken: vi.fn(() => Promise.resolve({ accessToken: 'a'.repeat(64) })),
    sendTailscaleSetup: vi.fn(() => Promise.resolve({ ok: true })),
    ...overrides,
  } as unknown as RemoteSettingsSectionProps & SectionSpies
  render(<RemoteSettingsSection {...props} />)
  const { close, createPairing, listDevices, revokeDevice, getAccessToken, sendTailscaleSetup } = props
  return { close, createPairing, listDevices, revokeDevice, getAccessToken, sendTailscaleSetup }
}

function useClipboard(writeText: () => Promise<void> | void): void {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
}

function silenceConsole(): MockInstance {
  return vi.spyOn(console, 'error').mockImplementation(() => {})
}

function openTab(label: string): void {
  fireEvent.click(screen.getByRole('tab', { name: label }))
}

describe('the guided Tailscale setup', () => {
  it('hands the task to the session and closes settings onto the conversation', async () => {
    const spies = renderSection()
    openTab(en.tailscaleHeading)
    fireEvent.click(screen.getByText(en.tailscaleAction))
    await waitFor(() => { expect(spies.close).toHaveBeenCalledTimes(1) })
    expect(spies.sendTailscaleSetup).toHaveBeenCalledTimes(1)
  })

  it('shows the in-flight state while the handoff runs', async () => {
    let resolve: (outcome: { ok: true }) => void = () => {}
    const spies = renderSection({
      sendTailscaleSetup: vi.fn(() => new Promise<{ ok: true }>((res) => { resolve = res })),
    })
    openTab(en.tailscaleHeading)
    fireEvent.click(screen.getByText(en.tailscaleAction))
    expect(screen.getByText(en.tailscaleSending)).toBeTruthy()
    await act(async () => { resolve({ ok: true }) })
    await waitFor(() => { expect(spies.close).toHaveBeenCalledTimes(1) })
  })

  it('stays with a hint when no ordinary session is open', async () => {
    const spies = renderSection({ sendTailscaleSetup: vi.fn(() => Promise.resolve({ ok: false, reason: 'no-session' })) })
    openTab(en.tailscaleHeading)
    fireEvent.click(screen.getByText(en.tailscaleAction))
    await waitFor(() => { expect(screen.getByText(en.tailscaleNoSession)).toBeTruthy() })
    expect(spies.close).not.toHaveBeenCalled()
  })

  it('stays with a hint when the handoff is rejected', async () => {
    const spies = renderSection({ sendTailscaleSetup: vi.fn(() => Promise.resolve({ ok: false, reason: 'error' })) })
    openTab(en.tailscaleHeading)
    fireEvent.click(screen.getByText(en.tailscaleAction))
    await waitFor(() => { expect(screen.getByText(en.tailscaleSendError)).toBeTruthy() })
    expect(spies.close).not.toHaveBeenCalled()
  })

  it('reports a thrown handoff as the error state', async () => {
    const err = silenceConsole()
    const spies = renderSection({ sendTailscaleSetup: vi.fn(() => Promise.reject(new Error('down'))) })
    openTab(en.tailscaleHeading)
    fireEvent.click(screen.getByText(en.tailscaleAction))
    await waitFor(() => { expect(screen.getByText(en.tailscaleSendError)).toBeTruthy() })
    expect(spies.close).not.toHaveBeenCalled()
    err.mockRestore()
  })
})

describe('the pairing card', () => {
  it('generates a code, reveals the payload, and copies it', async () => {
    vi.useFakeTimers()
    useClipboard(() => Promise.resolve())
    const spies = renderSection()
    await act(async () => {})
    fireEvent.click(screen.getByText(en.pairingGenerate))
    expect(screen.getByText(en.pairingLoading)).toBeTruthy()
    await act(async () => {})
    expect(spies.createPairing).toHaveBeenCalledTimes(1)
    // The pairing payload and the access token mask side by side.
    expect(screen.getAllByText(MASK).length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText(PAIRING.payload)).toBeNull()
    expect(screen.getByText(new RegExp(`^${en.pairingExpiresAt}:`))).toBeTruthy()
    fireEvent.click(screen.getByText(en.pairingReveal))
    expect(screen.getByText(PAIRING.payload)).toBeTruthy()
    fireEvent.click(screen.getByText(en.pairingCopyPayload))
    await act(async () => {})
    expect(screen.getByText(en.pairingCopied)).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(screen.getByText(en.pairingCopyPayload)).toBeTruthy()
    vi.useRealTimers()
  })

  it('keeps the payload usable when the clipboard is unavailable', async () => {
    vi.useFakeTimers()
    useClipboard(() => { throw new TypeError('no clipboard') })
    renderSection()
    await act(async () => {})
    fireEvent.click(screen.getByText(en.pairingGenerate))
    await act(async () => {})
    fireEvent.click(screen.getByText(en.pairingCopyPayload))
    await act(async () => {})
    expect(screen.queryByText(en.pairingCopied)).toBeNull()
    expect(screen.getByText(en.pairingCopyPayload)).toBeTruthy()
    vi.useRealTimers()
  })

  it('reports a pairing failure', async () => {
    const err = silenceConsole()
    renderSection({ createPairing: vi.fn(() => Promise.reject(new Error('down'))) })
    fireEvent.click(screen.getByText(en.pairingGenerate))
    await waitFor(() => { expect(screen.getByText(en.pairingError)).toBeTruthy() })
    err.mockRestore()
  })
})

describe('the device list', () => {
  it('lists devices with live status and refreshes after revoke', async () => {
    const spies = renderSection({
      listDevices: vi.fn()
        .mockResolvedValueOnce({
          devices: [
            { deviceId: 'd1', name: 'Pixel', platform: 'android', connected: true, lastSeenAt: '2026-01-01T10:00:00Z' },
            { deviceId: 'd2', name: 'Tablet', platform: 'android', connected: false, lastSeenAt: null },
          ],
        })
        .mockResolvedValueOnce({ devices: [] }),
    })
    openTab(en.devicesHeading)
    await waitFor(() => { expect(screen.getByText('Pixel')).toBeTruthy() })
    expect(screen.getByText(en.deviceConnected)).toBeTruthy()
    expect(screen.getByText(en.deviceOffline)).toBeTruthy()
    expect(screen.getByText(new RegExp(`^${en.deviceLastSeen}:`))).toBeTruthy()
    expect(screen.queryByText(en.devicesEmpty)).toBeNull()
    fireEvent.click(screen.getAllByText(en.deviceRevoke)[0]!)
    await waitFor(() => { expect(spies.revokeDevice).toHaveBeenCalledWith('d1') })
    await waitFor(() => { expect(screen.getByText(en.devicesEmpty)).toBeTruthy() })
  })

  it('marks a row while revoking and on revoke failure', async () => {
    let rejectRevoke: (error: Error) => void = () => {}
    renderSection({
      listDevices: vi.fn().mockResolvedValue({
        devices: [{ deviceId: 'd1', name: 'Pixel', platform: 'android', connected: false, lastSeenAt: null }],
      }),
      revokeDevice: vi.fn(() => new Promise<never>((_resolve, reject) => { rejectRevoke = reject })),
    })
    openTab(en.devicesHeading)
    await waitFor(() => { expect(screen.getByText('Pixel')).toBeTruthy() })
    fireEvent.click(screen.getByText(en.deviceRevoke))
    expect(screen.getByText(en.deviceRevoking)).toBeTruthy()
    await act(async () => { rejectRevoke(new Error('down')) })
    await waitFor(() => { expect(screen.getByText(en.revokeError)).toBeTruthy() })
    expect(screen.getByText(en.deviceRevoke)).toBeTruthy()
  })

  it('reports a device-list failure', async () => {
    const err = silenceConsole()
    renderSection({ listDevices: vi.fn(() => Promise.reject(new Error('down'))) })
    openTab(en.devicesHeading)
    await waitFor(() => { expect(screen.getByText(en.devicesError)).toBeTruthy() })
    err.mockRestore()
  })
})

describe('the access token card', () => {
  it('stays absent when the token read fails', async () => {
    const err = silenceConsole()
    renderSection({ getAccessToken: vi.fn(() => Promise.reject(new Error('down'))) })
    await waitFor(() => { expect(screen.getByText(en.devicesEmpty)).toBeTruthy() })
    expect(screen.queryByText(en.accessTokenHeading)).toBeNull()
    err.mockRestore()
  })

  it('reveals and copies the token', async () => {
    vi.useFakeTimers()
    useClipboard(() => Promise.resolve())
    renderSection()
    await act(async () => {})
    expect(screen.getByText(MASK)).toBeTruthy()
    fireEvent.click(screen.getByText(en.accessTokenReveal))
    expect(screen.getByText('a'.repeat(64))).toBeTruthy()
    fireEvent.click(screen.getByText(en.accessTokenCopy))
    await act(async () => {})
    expect(screen.getByText(en.pairingCopied)).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(screen.getByText(en.accessTokenCopy)).toBeTruthy()
    vi.useRealTimers()
  })

  it('keeps the token usable when the clipboard is unavailable', async () => {
    vi.useFakeTimers()
    useClipboard(() => { throw new TypeError('no clipboard') })
    renderSection()
    await act(async () => {})
    fireEvent.click(screen.getByText(en.accessTokenCopy))
    await act(async () => {})
    expect(screen.queryByText(en.pairingCopied)).toBeNull()
    vi.useRealTimers()
  })
})

describe('the tab bar', () => {
  it('defaults to pairing, switches panels, and keeps panels mounted', async () => {
    renderSection()
    const tab = (label: string) => screen.getByRole('tab', { name: label })
    expect(tab(en.pairingHeading).getAttribute('aria-selected')).toBe('true')
    const devicesPanel = await waitFor(() => {
      const panel = screen.getByText(en.devicesEmpty).closest('[role="tabpanel"]')
      if (panel === null) throw new Error('no devices panel')
      return panel
    })
    expect(devicesPanel).toHaveProperty('hidden', true)
    openTab(en.devicesHeading)
    expect(devicesPanel).toHaveProperty('hidden', false)
    expect(tab(en.devicesHeading).getAttribute('aria-selected')).toBe('true')
    expect(tab(en.pairingHeading).getAttribute('aria-selected')).toBe('false')
    // The hidden tailscale panel stays mounted behind its tab.
    expect(screen.getByText(en.tailscaleAction)).toBeTruthy()
  })

  it('moves the selection with ArrowLeft, ArrowRight, Home, and End', () => {
    renderSection()
    const tab = (label: string) => screen.getByRole('tab', { name: label })
    const selected = (label: string) => tab(label).getAttribute('aria-selected') === 'true'
    fireEvent.keyDown(tab(en.pairingHeading), { key: 'ArrowLeft' })
    expect(selected(en.tailscaleHeading)).toBe(true)
    fireEvent.keyDown(tab(en.tailscaleHeading), { key: 'ArrowLeft' })
    expect(selected(en.devicesHeading)).toBe(true)
    fireEvent.keyDown(tab(en.devicesHeading), { key: 'Home' })
    expect(selected(en.pairingHeading)).toBe(true)
    fireEvent.keyDown(tab(en.pairingHeading), { key: 'End' })
    expect(selected(en.tailscaleHeading)).toBe(true)
    fireEvent.keyDown(tab(en.tailscaleHeading), { key: 'ArrowRight' })
    expect(selected(en.pairingHeading)).toBe(true)
    fireEvent.keyDown(tab(en.pairingHeading), { key: 'A' })
    expect(selected(en.pairingHeading)).toBe(true)
  })
})

describe('the remote notice', () => {
  it('renders a notice when isLoopback is false and skips device calls', () => {
    const spies = renderSection({ isLoopback: false })
    expect(screen.getByText(en.configureInWebGuiTitle)).toBeTruthy()
    expect(screen.getByText(en.remoteDevicesRemoteDescription)).toBeTruthy()
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(spies.listDevices).not.toHaveBeenCalled()
    expect(spies.getAccessToken).not.toHaveBeenCalled()
  })
})
