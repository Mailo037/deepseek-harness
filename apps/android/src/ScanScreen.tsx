/**
 * Scan screen: shown on first launch (no stored config). The user either
 * scans a QR code from the PC's Settings → Remote page, or enters the
 * server URL + token manually. A pairing attempt swaps the whole screen for
 * the animated connecting flow (progress steps + cancel) instead of a
 * static "Connecting…" text.
 */

import { useRef, useState, type ReactNode } from 'react'
import { BarcodeScanner } from 'capacitor-barcode-scanner'
import {
  pairWithQrData,
  pairWithToken,
  type PairingResult,
  type PairingStage,
  type PairingStageListener,
} from './PairingService.ts'
import { parsePairingPayload } from './PairingProtocol.ts'
import { normalizeServerUrl, saveConfig, type DeviceConfig } from './DeviceStorage.ts'
import { ensureNotificationPermission } from './NotificationService.ts'
import { ConnectingScreen } from './ConnectingScreen.tsx'
import { AlertIcon, LogoMark, QrIcon } from './components/Brand.tsx'

interface PairingScreenProps {
  onPaired: (config: DeviceConfig) => void
}

/** Prefix the endpoint loop uses for its aggregated failure message. */
const ALL_ENDPOINTS_FAILED_PREFIX = 'All endpoints failed: '

/** Present an error without the aggregated-endpoints plumbing jargon. */
function describePairingError(error: unknown): string {
  let raw: string
  if (error instanceof Error) {
    raw = error.message
  } else {
    const encoded = JSON.stringify(error)
    raw = typeof encoded === 'string' ? encoded : String(error)
  }
  const text = raw.startsWith(ALL_ENDPOINTS_FAILED_PREFIX)
    ? raw.slice(ALL_ENDPOINTS_FAILED_PREFIX.length)
    : raw
  return text.length > 0 ? text : 'Pairing failed. Generate a new pairing code on the PC and try again.'
}

export function PairingScreen({ onPaired }: PairingScreenProps): ReactNode {
  const [pairing, setPairing] = useState<null | { stage: PairingStage }>(null)
  const [manualUrl, setManualUrl] = useState('')
  const [manualToken, setManualToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const onStage: PairingStageListener = (stage) => {
    setPairing(previous => (previous === null ? previous : { stage }))
  }

  const startPairing = async (result: PairingResult, signal: AbortSignal): Promise<void> => {
    const config: DeviceConfig = {
      serverUrl: result.serverUrl,
      endpoints: result.endpoints,
      deviceId: result.deviceId,
      deviceSecret: result.secret,
      deviceName: result.deviceName,
      accessToken: result.accessToken,
    }
    setPairing({ stage: { kind: 'setup' } })
    if (signal.aborted) return
    await saveConfig(config)
    onPaired(config)
    // Notifications enhance a connected session but do not establish it.
    // ConnectedScreen starts the service after this route change; the grant
    // request also runs without trapping the UI on "Connecting".
    void ensureNotificationPermission().catch(() => {
      // A denied or failed grant only suppresses Android attention banners.
    })
  }

  /** Run one pairing attempt: connecting screen up, cancel wired, error mapped. */
  const runPairing = async (
    attempt: (signal: AbortSignal) => Promise<PairingResult>,
    initialServerUrl: string,
  ): Promise<void> => {
    const controller = new AbortController()
    abortRef.current = controller
    setError(null)
    setPairing({ stage: { kind: 'finding', serverUrl: initialServerUrl } })
    try {
      const result = await attempt(controller.signal)
      await startPairing(result, controller.signal)
    } catch (attemptError) {
      // A user cancel is not an error: the connecting screen simply goes
      // away and the form stays as it was.
      if (!controller.signal.aborted) setError(describePairingError(attemptError))
    } finally {
      abortRef.current = null
      setPairing(null)
    }
  }

  const handleScan = async (): Promise<void> => {
    try {
      // No notification-permission request here: the camera permission is the
      // scanner plugin's own concern and the notification permission is
      // requested after pairing (startPairing). A blocking request here would
      // leave the button dead if the native call never settles.
      const result = await BarcodeScanner.scan()
      if (!result.result || result.code === undefined) return
      const code: string = result.code
      // Preview the first endpoint for the connecting UI; the service re-parses
      // (the parse is a pure function with no side effects).
      const payload = parsePairingPayload(code)
      const firstEndpoint = payload?.endpoints[0]
      await runPairing(signal => pairWithQrData(code, 'Android', signal, onStage), firstEndpoint ?? '…')
    } catch (scanError) {
      // The scanner plugin rejects when the user backs out of the camera view;
      // that is not a failure the pairing form should shout about.
      const text = scanError instanceof Error ? scanError.message : String(scanError)
      if (!text.toLowerCase().includes('cancel')) setError(describePairingError(scanError))
    }
  }

  const handleManualPair = async (): Promise<void> => {
    const serverUrl = normalizeServerUrl(manualUrl)
    if (serverUrl === null) {
      setError('That does not look like a server address. Try something like 192.168.1.5:3080.')
      return
    }
    const token = manualToken.trim()
    if (token.length === 0) {
      setError('Enter the pairing token shown on the PC.')
      return
    }
    await runPairing(signal => pairWithToken(serverUrl, token, 'Android', signal, onStage), serverUrl)
  }

  const handleCancel = (): void => {
    abortRef.current?.abort()
  }

  if (pairing !== null) {
    return <ConnectingScreen stage={pairing.stage} onCancel={handleCancel} />
  }

  return (
    <div className="screen screen-enter">
      <div className="brand">
        <LogoMark size={44} />
        <span className="brand-word">Harness Remote</span>
      </div>
      <p className="hint">
        Connect to the DeepSeek Harness running on your computer.
      </p>
      <button className="option-button" type="button" onClick={() => { void handleScan() }}>
        <span className="option-icon"><QrIcon /></span>
        <span className="option-copy">
          <span className="option-title">Scan QR Code</span>
          <span className="option-sub">Settings → Remote devices → Generate pairing code</span>
        </span>
      </button>
      {error !== null && (
        <div className="banner" role="alert">
          <AlertIcon size={16} />
          <span>{error}</span>
        </div>
      )}
      {error !== null && (
        <p className="hint">Pairing codes are single-use — if a retry fails, generate a new one on the PC.</p>
      )}
      <form
        className="manual-form"
        onSubmit={(event) => {
          event.preventDefault()
          void handleManualPair()
        }}
      >
        <div className="field">
          <label className="field-label" htmlFor="manual-url">Server address</label>
          <input
            id="manual-url"
            className="input"
            placeholder="192.168.1.5:3080"
            value={manualUrl}
            onChange={(event) => { setManualUrl(event.target.value) }}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            inputMode="url"
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="manual-token">Pairing token</label>
          <input
            id="manual-token"
            className="input"
            placeholder="Token from the pairing card"
            value={manualToken}
            onChange={(event) => { setManualToken(event.target.value) }}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>
        <button className="button connect-button" type="submit">
          Connect
        </button>
      </form>
    </div>
  )
}
