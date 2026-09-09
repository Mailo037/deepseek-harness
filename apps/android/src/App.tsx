/** Android shell with independent saved Harness pairings and notification routing. */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { DeviceConfig } from './DeviceStorage.ts'
import { activeHarnessId, addHarness, loadHarnesses, readHarness, removeHarness, selectHarness, type SavedHarness } from './HarnessStorage.ts'
import { getLaunchSession, onOpenSession, startNotificationService, stopNotificationService, type SessionTarget } from './NotificationService.ts'
import { initSystemBars } from './systemBars.ts'
import { HarnessChooser } from './HarnessChooser.tsx'
import { PairingScreen } from './ScanScreen.tsx'
import { ConnectedScreen } from './ConnectedScreen.tsx'
import { LogoMark } from './components/Brand.tsx'
import { checkForAppUpdate } from './AppUpdate.ts'

export function App(): ReactNode {
  const [harnesses, setHarnesses] = useState<SavedHarness[]>([])
  const [active, setActive] = useState<SavedHarness | null>(null)
  const [loading, setLoading] = useState(true)
  const [pairing, setPairing] = useState(false)
  const [chooser, setChooser] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [target, setTarget] = useState<SessionTarget | undefined>()
  const navigation = useRef(0)
  useLayoutEffect(() => initSystemBars(), [])

  const activate = useCallback(async (id: string, session?: SessionTarget): Promise<void> => {
    const revision = ++navigation.current
    setBusy(true)
    try {
      const harness = await readHarness(id)
      if (revision !== navigation.current) return
      await selectHarness(id)
      if (revision !== navigation.current) return
      setActive(harness)
      setTarget(session)
      setPairing(false)
      setChooser(false)
      setError(null)
    } catch {
      if (revision === navigation.current) setError('Could not open this Harness. Try again or pair it again.')
    } finally {
      if (revision === navigation.current) setBusy(false)
    }
  }, [])

  useEffect(() => {
    let disposed = false
    const isDisposed = (): boolean => disposed
    void checkForAppUpdate().catch(() => { /* Update availability does not control startup. */ })
    const boot = async (): Promise<void> => {
      const items = await loadHarnesses()
      if (isDisposed()) return
      setHarnesses(items)
      const selected = await activeHarnessId()
      if (isDisposed()) return
      setActive(items.find(h => h.id === selected) ?? (items.length > 0 ? items[0] : null))
      setPairing(items.length === 0)
      setLoading(false)
      for (const harness of items) {
        void startNotificationService(harness).catch(() => {
          if (!isDisposed()) setError('Background notifications could not start. Reopen the app to retry.')
        })
      }
    }
    const ready = boot().catch(() => { if (!isDisposed()) { setLoading(false); setError('Could not read saved Harnesses. Reopen the app to retry.') } })
    const listener = onOpenSession((session) => {
      void ready.then(() => { if (!isDisposed()) void activate(session.harnessId, session) })
    })
    void Promise.all([ready, listener]).then(() => getLaunchSession()).then((session) => {
      if (!isDisposed() && session) void activate(session.harnessId, session)
    }).catch(() => { /* The browser preview has no native notification bridge. */ })
    return () => { disposed = true; void listener.then((l) => { l.remove() }).catch(() => {}) }
  }, [activate])

  const paired = async (config: DeviceConfig): Promise<void> => {
    const harness = await addHarness(config)
    setHarnesses(await loadHarnesses())
    setActive(harness)
    setTarget(undefined)
    setPairing(false)
    setChooser(false)
    void startNotificationService(harness).catch(() => { setError('Connected, but background notifications could not start. Reopen the app to retry.') })
  }

  const forget = async (): Promise<void> => {
    if (!active || busy) return
    setBusy(true)
    try {
      await stopNotificationService(active.id)
      await removeHarness(active.id)
      const items = await loadHarnesses()
      setHarnesses(items)
      setActive(items.length > 0 ? items[0] : null)
      setTarget(undefined)
      setPairing(items.length === 0)
    } catch {
      setError('Could not remove this Harness. Try again.')
    } finally { setBusy(false) }
  }

  if (loading) return <div className="screen"><LogoMark size={36} /><p className="hint">Loading Harnesses…</p></div>
  return (
    <>
      {error && <div className="harness-error" role="alert">{error}<button className="bar-button" onClick={() => { setError(null) }}>Dismiss</button></div>}
      {pairing ? (
        <>
          {active && <button className="bar-button" onClick={() => { setPairing(false) }}>Back to {active.name}</button>}
          <PairingScreen onPaired={paired} />
        </>
      ) : active ? (
        <ConnectedScreen key={active.id} config={active.config} harnessId={active.id} harnessName={active.name} sessionTarget={target}
          onSwitch={() => { setChooser(true) }} onDisconnect={() => { void forget() }} />
      ) : null}
      {chooser && (
        <HarnessChooser harnesses={harnesses} activeId={active?.id} busy={busy}
          onChoose={(id) => { void activate(id) }}
          onAdd={() => { setChooser(false); setPairing(true) }} onClose={() => { setChooser(false) }} />
      )}
    </>
  )
}
