/**
 * Connected screen: a full-screen iframe with the PC-served web GUI plus a
 * status bar. The GUI is ALWAYS loaded fresh from the PC (thin-client
 * contract) — an app update is never needed for GUI improvements. A branded
 * loader covers the iframe during the connectivity probe so the user never
 * stares at a white flash, and it is removed the moment the probe confirms
 * the PC answers. When the PC is unreachable the status bar shows the
 * failure and the screen re-probes every 10 seconds so recovery needs no
 * manual tap. The probe sweeps the stored endpoints (last-successful first,
 * then LAN → Tailscale/extras) and adopts the first answering origin, so
 * network switches fail over without re-pairing. The native notification
 * service keeps running regardless.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Network } from '@capacitor/network'
import { guiUrlOf, persistAccessToken, persistLastSuccessful, type DeviceConfig } from './DeviceStorage.ts'
import { isTailscaleEndpoint, selectCandidates } from './EndpointSelection.ts'
import {
  getChannelState, getLaunchSession, isVpnActive, onChannelState, onOpenSession, startNotificationService,
} from './NotificationService.ts'
import {
  embeddedConnectionStateOf, openSessionMessageOf, type EmbeddedConnectionState,
} from './ShellProtocol.ts'
import { CloudOffIcon, EyeIcon, LogoMark, MonitorXIcon, PowerOffIcon, RefreshIcon } from './components/Brand.tsx'

interface ConnectedScreenProps {
  config: DeviceConfig
  onDisconnect: () => void
}

/** Whether the remote GUI origin answers (fetch probes the root document). */
async function probe(url: string, timeoutMs = 5000): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, timeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal, method: 'GET', mode: 'no-cors' })
    // no-cors responses are opaque; any response (or even a rejection after
    // TLS negotiation) means the origin is reachable enough to try.
    void response
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

export function ConnectedScreen({ config, onDisconnect }: ConnectedScreenProps): ReactNode {
  const [probeState, setProbeState] = useState<'checking' | 'online' | 'offline'>('checking')
  const [networkOnline, setNetworkOnline] = useState(true)
  // The remote GUI is covered by a branded loader only while the connectivity
  // probe is in flight. It is revealed the moment the probe answers, and the
  // iframe load event merely confirms it early — so a slow or flaky WebView
  // load event can never trap the user behind "Loading the remote GUI…".
  const [guiReady, setGuiReady] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [addressVisible, setAddressVisible] = useState(false)
  const [embeddedConnectionState, setEmbeddedConnectionState] = useState<EmbeddedConnectionState>('reconnecting')
  const [vpnActive, setVpnActive] = useState<boolean | undefined>()
  const [loadingSlow, setLoadingSlow] = useState(false)
  // The origin the GUI currently uses. It follows probe successes and native
  // channel migrations so LAN ↔ Tailscale switches never need a re-pair.
  const [origin, setOrigin] = useState(config.serverUrl)
  const originRef = useRef(origin)
  originRef.current = origin
  const [accessToken, setAccessToken] = useState(config.accessToken)
  const accessTokenRef = useRef(accessToken)
  accessTokenRef.current = accessToken
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const guiConfig = useMemo(() => ({ ...config, accessToken }), [config, accessToken])
  const guiUrl = guiUrlOf(guiConfig, origin)
  const tailscaleEndpoint = isTailscaleEndpoint(origin)

  // Service activation is recoverable and independent from GUI navigation.
  // Retrying here covers pairing-time bridge failures and stored sessions
  // restored after the Android process was killed.
  useEffect(() => {
    void startNotificationService(config).catch(() => {
      // The GUI remains usable; Android notifications retry on the next mount.
    })
  }, [config])

  /** Tell the served GUI which presentation shell embeds it. */
  const announceShell = useCallback((frame: HTMLIFrameElement): void => {
    frame.contentWindow?.postMessage({
      type: 'dsh/client-shell-context',
      version: 1,
      shell: 'android',
    }, new URL(guiUrl).origin)
  }, [guiUrl])

  const pendingSessionRef = useRef<string | null>(null)

  /** Ask the embedded web GUI to navigate to a specific session. */
  const openSessionInIframe = useCallback((sessionId: string): void => {
    const frame = iframeRef.current
    if (frame?.contentWindow && guiReady) {
      frame.contentWindow.postMessage(openSessionMessageOf(sessionId), new URL(guiUrl).origin)
    } else {
      pendingSessionRef.current = sessionId
    }
  }, [guiUrl, guiReady])

  /** Switch the GUI to a working origin and persist it as last-successful. */
  const adopt = useCallback((candidate: string): void => {
    if (candidate === originRef.current) return
    originRef.current = candidate
    setOrigin(candidate)
    void persistLastSuccessful(candidate).catch(() => {
      // A failed persist only costs one extra endpoint sweep after an app
      // restart; the GUI keeps working with the adopted origin either way.
    })
  }, [])

  /** Probe every candidate in order; true when one origin answered. */
  const probeCandidates = useCallback(async (): Promise<boolean> => {
    const candidates = selectCandidates(guiConfig.endpoints, originRef.current)
    for (const candidate of candidates) {
      if (await probe(guiUrlOf(guiConfig, candidate))) {
        adopt(candidate)
        return true
      }
    }
    return false
  }, [guiConfig, adopt])

  // The selected origin changed: force the branded loader back over the
  // iframe until the new origin's document fires its load event.
  useEffect(() => {
    setGuiReady(false)
    setDetailsOpen(false)
    setAddressVisible(false)
    setEmbeddedConnectionState('reconnecting')
  }, [origin, accessToken])

  useEffect(() => {
    const expectedOrigin = new URL(guiUrl).origin
    const onMessage = (event: MessageEvent<unknown>): void => {
      if (event.source !== iframeRef.current?.contentWindow || event.origin !== expectedOrigin) return
      const next = embeddedConnectionStateOf(event.data)
      if (next !== null) {
        setEmbeddedConnectionState(next)
        if (next === 'connected' && pendingSessionRef.current && iframeRef.current.contentWindow) {
          const sessionId = pendingSessionRef.current
          pendingSessionRef.current = null
          iframeRef.current.contentWindow.postMessage(openSessionMessageOf(sessionId), expectedOrigin)
        }
      }
    }
    window.addEventListener('message', onMessage)
    return () => { window.removeEventListener('message', onMessage) }
  }, [guiUrl])

  // Android exposes Tailscale as a VPN transport. Polling while a Tailscale
  // endpoint is selected catches a user enabling the app without requiring a
  // Harness restart; browser development has no native bridge and stays unknown.
  useEffect(() => {
    if (!tailscaleEndpoint) {
      setVpnActive(undefined)
      return
    }
    let disposed = false
    const refresh = (): void => {
      void isVpnActive().then((active) => {
        if (!disposed) setVpnActive(active)
      }).catch(() => {
        if (!disposed) setVpnActive(undefined)
      })
    }
    refresh()
    const timer = setInterval(refresh, 5_000)
    return () => {
      disposed = true
      clearInterval(timer)
    }
  }, [tailscaleEndpoint])

  useEffect(() => {
    if (guiReady) {
      setLoadingSlow(false)
      return
    }
    const timer = setTimeout(() => { setLoadingSlow(true) }, 3_500)
    return () => { clearTimeout(timer) }
  }, [guiReady])

  // Probe on mount and whenever the network state changes.
  useEffect(() => {
    // Boot truth for the device network state: without it a cold boot while
    // offline shows "PC not reachable" instead of "No network".
    void Network.getStatus().then((status) => { setNetworkOnline(status.connected) })
    const run = async (): Promise<void> => {
      setProbeState('checking')
      setGuiReady(false)
      const ok = await probeCandidates()
      setProbeState(ok ? 'online' : 'offline')
      setGuiReady(true)
    }
    void run()
    const listener = Network.addListener('networkStatusChange', (state) => {
      setNetworkOnline(state.connected)
      if (state.connected) void run()
    })
    return () => { void listener.then(l => l.remove()) }
  }, [probeCandidates])

  // Follow the native channel when it migrates endpoints (network change,
  // Doze recovery): the GUI origin tracks the connected channel origin.
  useEffect(() => {
    let disposed = false
    const applyChannelState = (state: Awaited<ReturnType<typeof getChannelState>>): void => {
      if (disposed) return
      if (state.connected && state.serverUrl !== undefined) adopt(state.serverUrl)
      if (state.accessToken !== undefined && state.accessToken !== accessTokenRef.current) {
        accessTokenRef.current = state.accessToken
        setAccessToken(state.accessToken)
        void persistAccessToken(state.accessToken).catch(() => {
          // The in-memory token still repairs this session when persistence fails.
        })
      }
    }
    const listener = onChannelState(applyChannelState)
    const refreshNativeState = async (): Promise<void> => {
      try {
        applyChannelState(await getChannelState())
      } catch {
        // A native state read can fail while the plugin is being torn down.
      }
    }
    void listener.then(refreshNativeState)
    // Android can authenticate the foreground service before the WebView has
    // attached its listener. Re-reading the authoritative native state also
    // repairs that startup race without requiring an app restart.
    const stateRefresh = setInterval(() => { void refreshNativeState() }, 2_000)
    return () => {
      disposed = true
      clearInterval(stateRefresh)
      void listener.then((activeListener) => { activeListener.remove() })
    }
  }, [adopt])

  // Listen for session open requests from launch intents and notifications.
  useEffect(() => {
    void getLaunchSession().then((session) => {
      if (session) openSessionInIframe(session)
    })
    const listener = onOpenSession((sessionId) => {
      openSessionInIframe(sessionId)
    })
    return () => {
      void listener.then((l) => {
        l.remove()
      })
    }
  }, [openSessionInIframe])

  // Flush any pending session navigation once the iframe document is ready.
  useEffect(() => {
    if (guiReady && pendingSessionRef.current && iframeRef.current?.contentWindow) {
      const sessionId = pendingSessionRef.current
      pendingSessionRef.current = null
      iframeRef.current.contentWindow.postMessage(openSessionMessageOf(sessionId), new URL(guiUrl).origin)
    }
  }, [guiReady, guiUrl])

  // While offline (and the device itself online), re-probe every 10 s; a
  // successful probe flips straight back to the online state with a fresh
  // GUI load.
  useEffect(() => {
    if (probeState !== 'offline' || !networkOnline) return
    const auto = setInterval(() => {
      void probeCandidates().then((ok) => {
        if (ok) {
          setGuiReady(false)
          setProbeState('online')
          setGuiReady(true)
        }
      })
    }, 10_000)
    return () => { clearInterval(auto) }
  }, [probeCandidates, probeState, networkOnline])

  // While online, keep verifying the PC still answers: two consecutive
  // failures flip to the unreachable screen (one failure may be a Wi-Fi
  // blip), so a dead session never hides behind a green dot.
  useEffect(() => {
    if (probeState !== 'online') return
    let failures = 0
    const watchdog = setInterval(() => {
      void probe(guiUrlOf(guiConfig, originRef.current)).then((ok) => {
        if (ok) {
          failures = 0
          return
        }
        failures += 1
        if (failures >= 2) {
          setGuiReady(false)
          setProbeState('offline')
        }
      })
    }, 10_000)
    return () => { clearInterval(watchdog) }
  }, [guiConfig, probeState])

  const retry = useCallback(() => {
    setProbeState('checking')
    setGuiReady(false)
    void probeCandidates().then((ok) => {
      setProbeState(ok ? 'online' : 'offline')
      setGuiReady(true)
    })
  }, [probeCandidates])

  const disconnect = useCallback(() => {
    onDisconnect()
  }, [onDisconnect])

  const online = probeState === 'online' && networkOnline
  const reconnecting = !online || embeddedConnectionState === 'reconnecting'
  const tailscaleAdvice = !tailscaleEndpoint
    ? null
    : vpnActive === false
      ? 'No active private network connection was detected. Open Tailscale and turn on its connection, then return here.'
      : vpnActive === true
        ? 'A private network connection is active. Make sure it is Tailscale and both devices are online in the same tailnet.'
        : 'This address uses Tailscale. Open the Tailscale app and make sure its connection is on.'
  const loadingAdvice = tailscaleEndpoint && vpnActive === false
    ? tailscaleAdvice
    : loadingSlow && tailscaleEndpoint
      ? tailscaleAdvice
      : loadingSlow
        ? 'Still connecting. Make sure this phone and PC can reach the same network.'
        : null

  return (
    <div className="iframe-wrapper">
      <div className="iframe-bar">
        <div
          className="connection-status"
          data-state={reconnecting ? 'reconnecting' : 'connected'}
          role="status"
          aria-live="polite"
          aria-label={reconnecting ? 'Reconnecting' : 'Remote, connected'}
        >
          <span className={`dot ${reconnecting ? 'reconnecting pulse' : 'connected pulse'}`} aria-hidden="true" />
          <span className="connection-status-window" aria-hidden="true">
            <span className="connection-status-track">
              <span className="connection-status-label">Remote</span>
              <span className="connection-status-label">Reconnecting</span>
            </span>
          </span>
        </div>
        <span className="bar-spacer" />
        {probeState === 'offline' && (
          <button className="bar-button compact" onClick={retry} aria-label="Retry connection" title="Retry connection">
            <RefreshIcon size={14} />
          </button>
        )}
        <button
          className="bar-button compact"
          onClick={() => {
            if (detailsOpen) setAddressVisible(false)
            setDetailsOpen(!detailsOpen)
          }}
          aria-label={detailsOpen ? 'Hide connection details' : 'Show connection details'}
          aria-expanded={detailsOpen}
          title="Connection details"
        >
          <EyeIcon size={17} />
        </button>
        {detailsOpen && (
          <div className="connection-details" role="dialog" aria-label="Connection details">
            <span className="connection-details-label">Connected computer</span>
            <div className="connection-address" data-address-revealed={addressVisible}>
              <span className="connection-details-url mono" aria-hidden={!addressVisible}>{origin}</span>
              {addressVisible ? (
                <button
                  type="button"
                  className="connection-address-hide"
                  onClick={() => { setAddressVisible(false) }}
                  aria-label="Hide connected computer address"
                >
                  Hide
                </button>
              ) : (
                <button
                  type="button"
                  className="connection-address-cover"
                  onClick={() => { setAddressVisible(true) }}
                  aria-label="Show connected computer address"
                >
                  <span>Show</span>
                </button>
              )}
            </div>
            <button className="bar-button danger" onClick={disconnect}>
              <PowerOffIcon size={14} />
              Disconnect
            </button>
          </div>
        )}
      </div>
      {!networkOnline ? (
        <div className="screen screen-enter">
          <span className="splash-mark"><CloudOffIcon size={28} /></span>
          <h1 className="title">No network</h1>
          <p className="hint">
            This device is offline. The remote GUI needs Wi-Fi or mobile data;
            notifications resume on reconnect.
          </p>
        </div>
      ) : probeState === 'offline' ? (
        <div className="screen screen-enter">
          <span className="splash-mark"><MonitorXIcon size={28} /></span>
          <h1 className="title">PC not reachable</h1>
          <p className="hint">
            The computer at <span className="mono">{origin}</span> is not answering. Make sure it is
            running <span className="mono">dsh --profile web</span> and that both devices share the network.
            Retrying automatically every 10 seconds.
          </p>
          {tailscaleAdvice !== null && (
            <p className="connection-advice" role="status">{tailscaleAdvice}</p>
          )}
          <button className="button" onClick={retry}>
            <RefreshIcon size={16} />
            Retry now
          </button>
          <button className="button ghost" onClick={disconnect}>Disconnect</button>
        </div>
      ) : (
        <div style={{ position: 'relative', flex: 1, display: 'flex' }}>
          <iframe
            key={guiUrl}
            ref={iframeRef}
            className="iframe-remote"
            src={guiUrl}
            title="Harness Remote GUI"
            onLoad={(event) => {
              setGuiReady(true)
              announceShell(event.currentTarget)
              if (pendingSessionRef.current) {
                const sessionId = pendingSessionRef.current
                pendingSessionRef.current = null
                event.currentTarget.contentWindow?.postMessage(openSessionMessageOf(sessionId), new URL(guiUrl).origin)
              }
            }}
          />
          {!guiReady && (
            <div className="gui-loader">
              <div className="splash-mark">
                <LogoMark size={32} />
                <span className="splash-ring" />
              </div>
              <p className="hint">Loading the remote GUI…</p>
              <span className="spinner" />
              {loadingAdvice !== null && (
                <p className="gui-loader-advice" role="status">{loadingAdvice}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
