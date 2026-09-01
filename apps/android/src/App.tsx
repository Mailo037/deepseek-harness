/**
 * App root: route between the pairing screen (no stored config) and the
 * connected screen. On disconnect the stored config is cleared and the
 * notification service stops. The boot state is a branded splash instead of
 * a bare "Loading…" hint.
 */

import { useCallback, useEffect, useLayoutEffect, useState, type ReactNode } from 'react'
import { loadConfig, clearConfig, type DeviceConfig } from './DeviceStorage.ts'
import { stopNotificationService } from './NotificationService.ts'
import { initSystemBars } from './systemBars.ts'
import { PairingScreen } from './ScanScreen.tsx'
import { ConnectedScreen } from './ConnectedScreen.tsx'
import { LogoMark } from './components/Brand.tsx'
import { checkForAppUpdate } from './AppUpdate.ts'

type Route =
  | { readonly kind: 'loading' }
  | { readonly kind: 'pairing' }
  | { readonly kind: 'connected'; readonly config: DeviceConfig }

export function App(): ReactNode {
  const [route, setRoute] = useState<Route>({ kind: 'loading' })

  useLayoutEffect(() => initSystemBars(), [])

  useEffect(() => {
    // Updates are strictly best-effort: a missing release, offline device,
    // or unavailable installer must not delay pairing or the remote GUI.
    void checkForAppUpdate().catch(() => {})
  }, [])

  useEffect(() => {
    void loadConfig()
      .then((config) => {
        setRoute(config === null ? { kind: 'pairing' } : { kind: 'connected', config })
      })
      .catch(() => {
        // A failed preference read leaves no usable config: the pairing
        // screen is the safe fallback, never an infinite splash.
        setRoute({ kind: 'pairing' })
      })
  }, [])

  const handleDisconnect = useCallback(async (): Promise<void> => {
    try {
      await stopNotificationService()
    } catch {
      // The service may already be dead: a failed stop must never keep the
      // stored config or strand the user on the connected screen.
    }
    try {
      await clearConfig()
    } catch {
      // Persistence failed once; routing to pairing still lets the user re-pair.
    }
    setRoute({ kind: 'pairing' })
  }, [])

  switch (route.kind) {
    case 'loading':
      return (
        <div className="screen">
          <div className="brand">
            <div className="splash-mark">
              <LogoMark size={36} />
              <span className="splash-ring" />
            </div>
            <span className="brand-word">Harness Remote</span>
          </div>
        </div>
      )
    case 'pairing':
      return <PairingScreen onPaired={(config) => { setRoute({ kind: 'connected', config }) }} />
    case 'connected':
      return <ConnectedScreen config={route.config} onDisconnect={() => { void handleDisconnect() }} />
  }
}
