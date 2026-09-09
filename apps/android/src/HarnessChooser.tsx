/** Modal Harness navigation; the browser owns focus containment and Escape handling. */
import { useEffect, useRef, type ReactNode } from 'react'
import type { SavedHarness } from './HarnessStorage.ts'

interface Props {
  harnesses: SavedHarness[]
  activeId?: string
  busy: boolean
  onChoose: (id: string) => void
  onAdd: () => void
  onClose: () => void
}

export function HarnessChooser({ harnesses, activeId, busy, onChoose, onAdd, onClose }: Props): ReactNode {
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
        <button key={harness.id} className="harness-choice" disabled={busy}
          aria-pressed={activeId === harness.id} onClick={() => { onChoose(harness.id) }}>
          <span>{harness.name}</span>{' '}<span className="harness-choice-state">{activeId === harness.id ? 'Active' : 'Open'}</span>
        </button>
      ))}
      <button className="button secondary" disabled={busy} onClick={onAdd}>Add Harness</button>
      <button className="button ghost" onClick={onClose}>Close</button>
    </dialog>
  )
}
