import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  AccessTokenView, PairingView, RemoteDeviceId, RemoteDevicesSnapshot, RevokeReceipt,
} from '@deepseek-ai/dsh-api-remotes/client'
import { type RemoteLocaleKey } from './locales.ts'
import css from './RemoteSettingsSection.module.css'

/** Placeholder shown for every secret until the user reveals it; the fixed width keeps the secret's real length from leaking. */
const SECRET_MASK = '•'.repeat(16)

/** The section's tabs in display order; every panel stays mounted and merely hides. */
const TABS = ['pairing', 'devices', 'tailscale'] as const

/** Locale key of each tab's label. */
const TAB_LABEL_KEY: Record<(typeof TABS)[number], RemoteLocaleKey> = {
  pairing: 'pairingHeading',
  devices: 'devicesHeading',
  tailscale: 'tailscaleHeading',
}

/** Outcome of handing the Tailscale setup task to the current session. */
export type TailscaleSendOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'no-session' | 'error' }

/** Registration-side Remote face consumed by this section. */
export interface RemoteSettingsSectionInjected {
  /** Create a fresh one-time pairing code. */
  createPairing: () => Promise<PairingView>
  /** List every paired device with live connection status. */
  listDevices: () => Promise<RemoteDevicesSnapshot>
  /** Revoke one device: kill its channel and remove its persistent record. */
  revokeDevice: (deviceId: RemoteDeviceId) => Promise<RevokeReceipt>
  /** Read the persistent GUI access token. */
  getAccessToken: () => Promise<AccessTokenView>
  /**
   * Send the localized Tailscale setup task into the current session as a
   * queued user turn; the agent executes the guided setup there. Fails without
   * a usable ordinary session (none open, or the current route is a subagent).
   */
  sendTailscaleSetup: () => Promise<TailscaleSendOutcome>
  /** Whether the connection is to loopback host (false when remote). */
  isLoopback?: boolean | undefined
}

/** Section component props assembled by the slot renderer. */
export type RemoteSettingsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.remote'>
  & InjectFace<RemoteSettingsSectionInjected>

type PairingState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly pairing: PairingView }
  | { readonly status: 'error' }

/** Mutable state of the Tailscale guided-setup group. */
type TailscaleState =
  | { readonly status: 'idle' }
  | { readonly status: 'sending' }
  | { readonly status: 'no-session' }
  | { readonly status: 'error' }

type DevicesState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready' }

/** One device row's mutable local state. */
interface DeviceRowState {
  readonly deviceId: RemoteDeviceId
  readonly name: string
  readonly platform: string
  readonly connected: boolean
  readonly lastSeenAt: string | null
  /** Whether the revoke action is in flight for this row. */
  revoking: boolean
  /** Whether the last revoke attempt failed for this row. */
  revokeError: boolean
}

function rowsOf(snapshot: RemoteDevicesSnapshot): DeviceRowState[] {
  return snapshot.devices.map(d => ({
    deviceId: d.deviceId,
    name: d.name,
    platform: d.platform,
    connected: d.connected,
    lastSeenAt: d.lastSeenAt,
    revoking: false,
    revokeError: false,
  }))
}

/**
 * The Remote devices settings section: three tabs (pairing code, paired
 * devices, guided Tailscale setup) over the host `device` Remote namespace.
 * Panels stay mounted and hide, so pairing state and the device snapshot
 * survive switching.
 */
export function RemoteSettingsSection(props: RemoteSettingsSectionProps): ReactNode {
  const { t, isLoopback } = props
  if (isLoopback === false) {
    return (
      <div className={css.section}>
        <div className={css.remoteNotice}>
          <p className={css.remoteNoticeTitle}>{t('configureInWebGuiTitle')}</p>
          <p className={css.remoteNoticeDescription}>{t('remoteDevicesRemoteDescription')}</p>
        </div>
      </div>
    )
  }
  return <RemoteSettingsSectionContent {...props} />
}

function RemoteSettingsSectionContent({
  t,
  close,
  createPairing,
  listDevices,
  revokeDevice,
  getAccessToken,
  sendTailscaleSetup,
}: RemoteSettingsSectionProps): ReactNode {
  const tabsId = useId()
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]>('pairing')
  const [pairing, setPairing] = useState<PairingState>({ status: 'idle' })
  const [devices, setDevices] = useState<DevicesState>({ status: 'loading' })
  const [rows, setRows] = useState<DeviceRowState[]>([])
  const [copyLabel, setCopyLabel] = useState<string>(t('pairingCopyPayload'))
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [tokenCopyLabel, setTokenCopyLabel] = useState<string>(t('accessTokenCopy'))
  /** Whether the pairing payload and the access token are currently shown in clear; both start masked. */
  const [payloadRevealed, setPayloadRevealed] = useState(false)
  const [tokenRevealed, setTokenRevealed] = useState(false)
  const [tailscale, setTailscale] = useState<TailscaleState>({ status: 'idle' })

  const handleTailscaleSetup = useCallback(async (): Promise<void> => {
    setTailscale({ status: 'sending' })
    try {
      const outcome = await sendTailscaleSetup()
      if (outcome.ok) {
        // The task runs in the conversation; the modal closes onto it.
        close()
        return
      }
      setTailscale({ status: outcome.reason === 'no-session' ? 'no-session' : 'error' })
    } catch (error) {
      console.error('tailscale setup handoff failed:', error)
      setTailscale({ status: 'error' })
    }
  }, [sendTailscaleSetup, close])

  const refreshDevices = useCallback(async (): Promise<void> => {
    setDevices({ status: 'loading' })
    try {
      const snapshot = await listDevices()
      setRows(rowsOf(snapshot))
      setDevices({ status: 'ready' })
    } catch (error) {
      console.error('remote devices list failed:', error)
      setDevices({ status: 'error' })
    }
  }, [listDevices])

  // Load devices and the access token on mount.
  useEffect(() => {
    void refreshDevices()
    getAccessToken().then((view) => { setAccessToken(view.accessToken) }).catch((error: unknown) => {
      console.error('access token read failed:', error)
    })
  }, [refreshDevices, getAccessToken])

  const handleGenerate = useCallback(async (): Promise<void> => {
    setPairing({ status: 'loading' })
    try {
      const pairing = await createPairing()
      setPayloadRevealed(false)
      setPairing({ status: 'ready', pairing })
    } catch (error) {
      console.error('pairing create failed:', error)
      setPairing({ status: 'error' })
    }
  }, [createPairing])

  const handleCopy = useCallback(async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      setCopyLabel(t('pairingCopied'))
      setTimeout(() => { setCopyLabel(t('pairingCopyPayload')) }, 2000)
    } catch {
      // Clipboard unavailable — the payload text remains selectable.
    }
  }, [t])

  const handleRevoke = useCallback(async (deviceId: RemoteDeviceId): Promise<void> => {
    setRows(prev => prev.map(row =>
      row.deviceId === deviceId ? { ...row, revoking: true, revokeError: false } : row,
    ))
    try {
      await revokeDevice(deviceId)
      await refreshDevices()
    } catch {
      setRows(prev => prev.map(row =>
        row.deviceId === deviceId ? { ...row, revoking: false, revokeError: true } : row,
      ))
    }
  }, [revokeDevice, refreshDevices])

  const handleCopyToken = useCallback(async (): Promise<void> => {
    if (accessToken === null) return
    try {
      await navigator.clipboard.writeText(accessToken)
      setTokenCopyLabel(t('pairingCopied'))
      setTimeout(() => { setTokenCopyLabel(t('accessTokenCopy')) }, 2000)
    } catch {
      // Clipboard unavailable — the token text remains selectable.
    }
  }, [accessToken, t])

  const moveTabFocus = (from: number, key: string): void => {
    let nextIndex: number
    switch (key) {
      case 'ArrowRight': nextIndex = (from + 1) % TABS.length; break
      case 'ArrowLeft': nextIndex = (from - 1 + TABS.length) % TABS.length; break
      case 'Home': nextIndex = 0; break
      case 'End': nextIndex = TABS.length - 1; break
      default: return
    }
    const nextTab = TABS[nextIndex] as (typeof TABS)[number]
    setActiveTab(nextTab)
    tabRefs.current[nextIndex]?.focus()
  }

  return (
    <div className={css.section}>
      <div className={css.tabs} role="tablist" aria-label={t('nav')}>
        {TABS.map((tab, index) => {
          const selected = tab === activeTab
          return (
            <button
              key={tab}
              ref={(element) => { tabRefs.current[index] = element }}
              id={`${tabsId}-tab-${tab}`}
              type="button"
              role="tab"
              className={css.tab}
              aria-selected={selected}
              aria-controls={`${tabsId}-panel-${tab}`}
              data-active={selected ? 'true' : undefined}
              tabIndex={selected ? 0 : -1}
              onClick={() => { setActiveTab(tab) }}
              onKeyDown={(event) => { moveTabFocus(index, event.key) }}
            >
              {t(TAB_LABEL_KEY[tab])}
            </button>
          )
        })}
      </div>

      {TABS.map((tab) => {
        const selected = tab === activeTab
        return (
          <div
            key={tab}
            id={`${tabsId}-panel-${tab}`}
            className={css.panel}
            role="tabpanel"
            aria-labelledby={`${tabsId}-tab-${tab}`}
            hidden={!selected}
          >
            {tab === 'pairing' && (
              <>
                <p className={css.hint}>{t('pairingHint')}</p>
                <div className={css.qrCard}>
                  {pairing.status === 'idle' && (
                    <Button onClick={() => { void handleGenerate() }}>{t('pairingGenerate')}</Button>
                  )}
                  {pairing.status === 'loading' && <p className={css.hint}>{t('pairingLoading')}</p>}
                  {pairing.status === 'error' && <p className={css.hint}>{t('pairingError')}</p>}
                  {pairing.status === 'ready' && (
                    <>
                      <img
                        className={css.qrImage}
                        src={pairing.pairing.qrDataUrl}
                        alt={t('pairingHeading')}
                      />
                      <div className={css.payloadLine}>
                        <span
                          className={css.payload}
                          title={payloadRevealed ? pairing.pairing.payload : undefined}
                        >
                          {payloadRevealed ? pairing.pairing.payload : SECRET_MASK}
                        </span>
                        <Button onClick={() => { setPayloadRevealed(v => !v) }}>
                          {payloadRevealed ? t('pairingHide') : t('pairingReveal')}
                        </Button>
                        <Button onClick={() => { void handleCopy(pairing.pairing.payload) }}>
                          {copyLabel}
                        </Button>
                      </div>
                      <p className={css.hint}>
                        {t('pairingExpiresAt')}: {new Date(pairing.pairing.expiresAt).toLocaleString()}
                      </p>
                    </>
                  )}
                </div>
                {accessToken !== null && (
                  <div className={css.subGroup}>
                    <h2 className={css.subTitle}>{t('accessTokenHeading')}</h2>
                    <p className={css.hint}>{t('accessTokenHint')}</p>
                    <div className={css.qrCard}>
                      <div className={css.payloadLine}>
                        <span className={css.payload} title={tokenRevealed ? accessToken : undefined}>
                          {tokenRevealed ? accessToken : SECRET_MASK}
                        </span>
                        <Button onClick={() => { setTokenRevealed(v => !v) }}>
                          {tokenRevealed ? t('accessTokenHide') : t('accessTokenReveal')}
                        </Button>
                        <Button onClick={() => { void handleCopyToken() }}>{tokenCopyLabel}</Button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
            {tab === 'devices' && (
              <>
                {devices.status === 'loading' && <p className={css.hint}>{t('devicesLoading')}</p>}
                {devices.status === 'error' && <p className={css.hint}>{t('devicesError')}</p>}
                {devices.status === 'ready' && rows.length === 0 && (
                  <p className={css.hint}>{t('devicesEmpty')}</p>
                )}
                {devices.status === 'ready' && rows.length > 0 && (
                  <div>
                    {rows.map(row => (
                      <div key={row.deviceId} className={css.row}>
                        <div className={css.deviceInfo}>
                          <span className={css.deviceName}>{row.name}</span>
                          <div className={css.deviceMeta}>
                            <span
                              className={`${css.statusDot} ${row.connected ? css.statusConnected : css.statusOffline}`}
                            />
                            <span>{row.connected ? t('deviceConnected') : t('deviceOffline')}</span>
                            {row.lastSeenAt !== null && (
                              <span>
                                {t('deviceLastSeen')}: {new Date(row.lastSeenAt).toLocaleString()}
                              </span>
                            )}
                            <span>{row.platform}</span>
                          </div>
                          {row.revokeError && <span className={css.hint}>{t('revokeError')}</span>}
                        </div>
                        <Button
                          onClick={() => { void handleRevoke(row.deviceId) }}
                          disabled={row.revoking}
                        >
                          {row.revoking ? t('deviceRevoking') : t('deviceRevoke')}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
            {tab === 'tailscale' && (
              <>
                <p className={css.hint}>{t('tailscaleHint')}</p>
                {tailscale.status === 'idle' && (
                  <div>
                    <Button onClick={() => { void handleTailscaleSetup() }}>{t('tailscaleAction')}</Button>
                  </div>
                )}
                {tailscale.status === 'sending' && <p className={css.hint}>{t('tailscaleSending')}</p>}
                {tailscale.status === 'no-session' && <p className={css.hint}>{t('tailscaleNoSession')}</p>}
                {tailscale.status === 'error' && <p className={css.hint}>{t('tailscaleSendError')}</p>}
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
