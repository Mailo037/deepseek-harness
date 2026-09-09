/** Manual release checks remain available independently of Harness connectivity. */
import { useState, type ReactNode } from 'react'
import { checkForAppUpdate } from './AppUpdate.ts'

export function AppUpdateControl(): ReactNode {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const check = async (): Promise<void> => {
    setBusy(true)
    setMessage('Checking and downloading any available update…')
    try {
      const result = await checkForAppUpdate(true)
      switch (result.status) {
        case 'current': setMessage('Your app is up to date.'); break
        case 'installerOpened': setMessage('Update downloaded. Complete installation in Android. You can retry here if installation was cancelled.'); break
        case 'incompatible': setMessage('This release cannot update your installed app because its package, version or signing certificate is incompatible.'); break
        case 'busy': setMessage('An update check or download is already running. Try again shortly.'); break
        case 'skipped': setMessage('Try checking again.'); break
      }
    } catch {
      setMessage('Could not check or download the update. Check your connection and try again.')
    } finally { setBusy(false) }
  }
  return <div className="app-update-control">
    <button className="button ghost" disabled={busy} onClick={() => { void check() }}>
      {busy ? 'Checking for updates…' : 'Check for updates'}
    </button>
    {message && <p className="hint" role="status">{message}</p>}
  </div>
}
