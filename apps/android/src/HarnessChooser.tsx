import { AppUpdateControl } from './AppUpdateControl.tsx'
/** Modal Harness navigation; the browser owns focus containment and Escape handling. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { SavedHarness } from './HarnessStorage.ts'

interface Props {
  harnesses: SavedHarness[]
  activeId?: string
  busy: boolean
  onChoose: (id: string) => void
  onRename: (id: string, name: string) => Promise<void>
  onAdd: () => void
  onClose: () => void
}

export function HarnessChooser({ harnesses, activeId, busy, onChoose, onRename, onAdd, onClose }: Props): ReactNode {
  const [editing, setEditing] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => { element?.close() }
  }, [])
  return (
    <dialog ref={dialog} className="harness-chooser" aria-label="Harnesses" onCancel={onClose}>
      <h1 className="harness-chooser-title">Harnesses</h1>
      <p className="harness-chooser-hint">All saved Harnesses stay connected for notifications.</p>
      {harnesses.map(harness => (
        <div key={harness.id} className="harness-choice-row">
          {editing === harness.id ? (
            <form className="harness-rename" onSubmit={(event) => {
              event.preventDefault()
              void onRename(harness.id, name).then(() => { setEditing(null); setError(null) })
                .catch(() => { setError('Could not save the name. Try again.') })
            }}>
              <label className="field-label" htmlFor="harness-name">Harness name</label>
              <input id="harness-name" className="input" value={name} maxLength={80} autoFocus
                disabled={busy} onChange={(event) => { setName(event.target.value) }} />
              {error && <p role="alert">{error}</p>}
              <div className="harness-rename-actions">
                <button className="bar-button" type="submit" disabled={busy || !name.trim()}>Save</button>
                <button className="bar-button" type="button" disabled={busy} onClick={() => { setEditing(null); setError(null) }}>Cancel</button>
              </div>
            </form>
          ) : (
            <>
              <button className="harness-choice" disabled={busy}
                aria-pressed={activeId === harness.id} onClick={() => { onChoose(harness.id) }}>
                <span>{harness.name}</span>{' '}<span className="harness-choice-state">{activeId === harness.id ? 'Active' : 'Open'}</span>
              </button>
              <button className="bar-button" disabled={busy} aria-label={`Rename ${harness.name}`}
                onClick={() => { setEditing(harness.id); setName(harness.name); setError(null) }}>Rename</button>
            </>
          )}
        </div>
      ))}
      <button className="button secondary" disabled={busy} onClick={onAdd}>Add Harness</button>
      <button className="button ghost" onClick={onClose}>Close</button>
      <AppUpdateControl />
    </dialog>
  )
}
