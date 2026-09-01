// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RemoteSettingsSection } from '../src/client/RemoteSettingsSection.tsx'
import type {
  RemoteSettingsSectionInjected,
  RemoteSettingsSectionProps,
} from '../src/client/RemoteSettingsSection.tsx'
import { FsDenySection } from '../src/client/FsDenySection.tsx'
import type {
  FsDenySectionInjected,
  FsDenySectionProps,
} from '../src/client/FsDenySection.tsx'
import { en, type RemoteLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: RemoteLocaleKey): string => en[key]) as RemoteSettingsSectionProps['t']

function props(overrides?: Partial<RemoteSettingsSectionInjected>): RemoteSettingsSectionProps {
  return {
    t,
    createPairing: overrides?.createPairing ?? vi.fn(async () => ({
      token: 'tok-1',
      expiresAt: '2025-01-02T00:00:00Z',
      payload: '{"v":1,"endpoints":["127.0.0.1:3080"],"token":"tok-1"}',
      qrDataUrl: 'data:image/png;base64,FAKEQR',
    })),
    listDevices: overrides?.listDevices ?? vi.fn(async () => ({ devices: [] })),
    revokeDevice: overrides?.revokeDevice ?? vi.fn(async () => ({ deviceId: 'd1' as never, revoked: true })),
    getAccessToken: overrides?.getAccessToken ?? vi.fn(async () => ({ accessToken: 'token-abc' })),
  } as RemoteSettingsSectionProps
}

describe('RemoteSettingsSection', () => {
  it('shows the empty state with a generate button', async () => {
    render(<RemoteSettingsSection {...props()} />)
    expect(await screen.findByText(en.devicesEmpty)).toBeTruthy()
    expect(screen.getByRole('button', { name: en.pairingGenerate })).toBeTruthy()
    const pairingTab = screen.getByRole('tab', { name: en.pairingHeading })
    expect(pairingTab.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: en.devicesHeading })).toBeTruthy()
  })

  it('generates a pairing code and reveals the payload only through the toggle', async () => {
    const payload = '{"v":1,"endpoints":["127.0.0.1:3080"],"token":"tok-1"}'
    render(<RemoteSettingsSection {...props()} />)
    fireEvent.click(await screen.findByRole('button', { name: en.pairingGenerate }))
    await waitFor(() => {
      expect(screen.getByRole('img', { name: en.pairingHeading })).toBeTruthy()
    })
    // The payload starts masked; showing it is an explicit toggle and hiding re-masks.
    expect(screen.queryByText(payload)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.pairingReveal }))
    expect(await screen.findByText(payload)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.pairingHide }))
    expect(screen.queryByText(payload)).toBeNull()
    expect(screen.getByText(new RegExp(en.pairingExpiresAt))).toBeTruthy()
  })

  it('copies the payload via the clipboard', async () => {
    const writeText = vi.fn(async () => {})
    Object.assign(navigator, { clipboard: { writeText } })
    render(<RemoteSettingsSection {...props()} />)
    fireEvent.click(await screen.findByRole('button', { name: en.pairingGenerate }))
    const copy = await screen.findByRole('button', { name: en.pairingCopyPayload })
    fireEvent.click(copy)
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('{"v":1,"endpoints":["127.0.0.1:3080"],"token":"tok-1"}')
    })
    expect(await screen.findByRole('button', { name: en.pairingCopied })).toBeTruthy()
  })

  it('shows an error when pairing generation fails', async () => {
    const createPairing = vi.fn(async () => { throw new Error('boom') })
    render(<RemoteSettingsSection {...props({ createPairing })} />)
    fireEvent.click(await screen.findByRole('button', { name: en.pairingGenerate }))
    expect(await screen.findByText(en.pairingError)).toBeTruthy()
  })

  it('renders paired devices with connection status and platform', async () => {
    const listDevices = vi.fn(async () => ({
      devices: [
        { deviceId: 'd1' as never, name: 'Pixel 8', platform: 'Android', connected: true, lastSeenAt: '2025-01-01T00:00:00Z', createdAt: '2025-01-01T00:00:00Z' },
        { deviceId: 'd2' as never, name: 'Old Tablet', platform: 'Android', connected: false, lastSeenAt: null, createdAt: '2025-01-01T00:00:00Z' },
      ],
    }))
    render(<RemoteSettingsSection {...props({ listDevices })} />)
    fireEvent.click(screen.getByRole('tab', { name: en.devicesHeading }))
    expect(await screen.findByText('Pixel 8')).toBeTruthy()
    expect(screen.getByText('Old Tablet')).toBeTruthy()
    expect(screen.getAllByText('Android')).toHaveLength(2)
    expect(screen.getAllByText(en.deviceConnected)).toHaveLength(1)
    expect(screen.getAllByText(en.deviceOffline)).toHaveLength(1)
  })

  it('revokes a device and refreshes the list', async () => {
    const revokeDevice = vi.fn(async () => ({ deviceId: 'd1' as never, revoked: true }))
    const device = {
      deviceId: 'd1' as never,
      name: 'Pixel 8',
      platform: 'Android',
      connected: true,
      lastSeenAt: null,
      createdAt: '2025-01-01T00:00:00Z',
    }
    const listDevices = vi.fn()
      .mockResolvedValueOnce({ devices: [device] })
      .mockResolvedValueOnce({ devices: [] })
    render(<RemoteSettingsSection {...props({ listDevices, revokeDevice })} />)
    fireEvent.click(screen.getByRole('tab', { name: en.devicesHeading }))
    fireEvent.click(await screen.findByRole('button', { name: en.deviceRevoke }))
    await waitFor(() => {
      expect(revokeDevice).toHaveBeenCalledWith('d1' as never)
    })
    expect(await screen.findByText(en.devicesEmpty)).toBeTruthy()
  })

  it('masks the access token until explicitly revealed', async () => {
    render(<RemoteSettingsSection {...props()} />)
    await screen.findByRole('heading', { name: en.accessTokenHeading })
    expect(screen.queryByText('token-abc')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.accessTokenReveal }))
    expect(await screen.findByText('token-abc')).toBeTruthy()
    expect(screen.getByRole('button', { name: en.accessTokenCopy })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.accessTokenHide }))
    expect(screen.queryByText('token-abc')).toBeNull()
  })

  it('shows an error when the device list cannot be loaded', async () => {
    const listDevices = vi.fn(async () => { throw new Error('boom') })
    render(<RemoteSettingsSection {...props({ listDevices })} />)
    expect(await screen.findByText(en.devicesError)).toBeTruthy()
  })
})

describe('FsDenySection', () => {
  const fsT = ((key: RemoteLocaleKey): string => en[key]) as FsDenySectionProps['t']

  function fsProps(overrides?: Partial<FsDenySectionInjected>): FsDenySectionProps {
    return {
      t: fsT,
      settingsScope: overrides?.settingsScope ?? {
        getSnapshot: () => ({ status: 'ready', value: { patterns: ['**/.env'] }, base: undefined, user: undefined, revision: 0, writable: true, mode: 'host' }),
        set: vi.fn(async () => {}),
        unset: vi.fn(),
        subscribe: () => () => {},
      },
    } as FsDenySectionProps
  }

  it('loads the stored patterns into the textarea', async () => {
    render(<FsDenySection {...fsProps()} />)
    const box = screen.getByRole('textbox')
    expect(await screen.findByRole('textbox')).toBeTruthy()
    expect((box as HTMLTextAreaElement).value).toBe('**/.env')
  })

  it('saves edited patterns through the settings scope', async () => {
    const set = vi.fn(async () => {})
    render(<FsDenySection {...fsProps({ settingsScope: { getSnapshot: () => ({ status: 'ready', value: { patterns: [] }, base: undefined, user: undefined, revision: 0, writable: true, mode: 'host' }), set, unset: vi.fn(), subscribe: () => () => {} } })} />)
    const textarea = (await screen.findByRole('textbox')) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '**/.env\nnode_modules/**' } })
    fireEvent.click(screen.getByRole('button', { name: en.fsDenySave }))
    await waitFor(() => {
      expect(set).toHaveBeenCalledWith('patterns', ['**/.env', 'node_modules/**'])
    })
    expect(await screen.findByText(en.fsDenySaved)).toBeTruthy()
  })

  it('allows discarding unsaved changes', async () => {
    render(<FsDenySection {...fsProps()} />)
    const textarea = (await screen.findByRole('textbox')) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'new-pattern' } })
    fireEvent.click(screen.getByRole('button', { name: en.fsDenyDiscard }))
    expect(textarea.value).toBe('**/.env')
  })
})
