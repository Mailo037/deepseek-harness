/**
 * The conversation session header's more-options entry: one ellipsis button
 * opening the current session's verb menu — rename, fork, move to another
 * workspace (project), download the session log, archive. Dialogs are
 * component-local so a session switch tears down any pending edit together
 * with the session it targeted; the log-download row drives the export
 * feature's controller and its shared result dialog reports the outcome.
 * Presentation only: every verb arrives through the inject face, and the
 * data reads run through the framework's global hooks.
 */
import { useRef, useState } from 'react'
import {
  Button, IconArchiveOutline20, IconBranchOutline16, IconDownloadOutline16, IconEditOutline16,
  IconEllipsisOutline16, IconFolderOpenOutline16, IconPinOutline16, Menu, Modal, Select,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionOptionsActionProps } from './contract/slots.ts'
import css from './SessionOptionsAction.module.css'

/**
 * Render the more-options menu and its dialogs for the current session.
 * @param props - session runtime share + injected verbs + bound download
 *   mirror + locale seat.
 * @returns the ellipsis trigger with its menu, or null while the session is
 *   blank (a provisional New Session has nothing to rename, fork, move,
 *   download, or archive yet — the same rule as the browser's row menus).
 */
export function SessionOptionsAction({
  sessionId, useSessions, useWorkspaces, useSessionLogDownload, renderSlot,
  renameSession, forkSession, archiveSession, setSessionPinned, moveSession, downloadSessionLog, t,
}: SessionOptionsActionProps) {
  const blank = useSessions(s => s.byId[sessionId]?.blank === true)
  const currentTitle = useSessions(s => s.byId[sessionId]?.displayTitle ?? '')
  const workspaces = useWorkspaces(s => s.items)
  const pinned = useWorkspaces(s => s.pinnedSessionIds.includes(sessionId))
  const downloading = useSessionLogDownload(
    s => s.bySession[String(sessionId)]?.status === 'downloading',
  )
  const [menuOpen, setMenuOpen] = useState(false)
  const composingRef = useRef(false)

  // Rename dialog state (unchanged title confirms: the gesture pins the
  // current automatic title — the same rule as the browser's row dialog).
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameDraft, setRenameDraft] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)
  const openRename = (currentTitle: string) => {
    setRenameDraft(currentTitle)
    setRenameError(null)
    setRenameOpen(true)
  }
  const closeRename = () => {
    if (renaming) return
    setRenameOpen(false)
    setRenameError(null)
  }
  const confirmRename = () => {
    const trimmed = renameDraft.trim()
    if (renaming || trimmed === '') return
    setRenaming(true)
    setRenameError(null)
    renameSession(sessionId, trimmed).then(() => {
      setRenaming(false)
      setRenameOpen(false)
    }).catch((reason: unknown) => {
      setRenaming(false)
      setRenameError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  // Move dialog state.
  const [moveOpen, setMoveOpen] = useState(false)
  const [moveTargetWorkspaceId, setMoveTargetWorkspaceId] = useState<string>('')
  const [moving, setMoving] = useState(false)
  const [moveError, setMoveError] = useState<string | null>(null)
  const openMove = () => {
    setMoveTargetWorkspaceId(workspaces[0]?.workspaceId ?? '')
    setMoveError(null)
    setMoveOpen(true)
  }
  const closeMove = () => {
    if (moving) return
    setMoveOpen(false)
    setMoveError(null)
  }
  const confirmMove = () => {
    if (moving || moveTargetWorkspaceId === '') return
    setMoving(true)
    setMoveError(null)
    moveSession(sessionId, moveTargetWorkspaceId as WorkspaceId).then(() => {
      setMoving(false)
      setMoveOpen(false)
    }).catch((reason: unknown) => {
      setMoving(false)
      setMoveError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  // Archive commits without a dialog: not destructive (the log and the
  // accounting slot remain), and archiving the current session clears the
  // selection on the state echo. Failures stay console diagnostics.
  const confirmArchive = () => {
    archiveSession(sessionId).catch((reason: unknown) => {
      console.warn('session archive rejected:', reason)
    })
  }

  if (blank) return null

  const menuItems = [
    {
      id: 'pin',
      label: pinned ? t('menu.unpinSession') : t('menu.pinSession'),
      icon: <IconPinOutline16 />,
    },
    { id: 'rename', label: t('rename'), icon: <IconEditOutline16 /> },
    { id: 'fork', label: t('menu.fork'), icon: <IconBranchOutline16 /> },
    ...workspaces.length > 0
      ? [{ id: 'move', label: t('menu.moveSession'), icon: <IconFolderOpenOutline16 /> }]
      : [],
    // The export feature owns the outcome dialog; the row only starts the
    // download and disables while this session's export is in flight.
    ...downloadSessionLog !== undefined
      ? [{
        id: 'download',
        label: t('menu.downloadLog'),
        icon: <IconDownloadOutline16 />,
        disabled: downloading,
      }]
      : [],
    // 20-native glyph in the menu's 16px icon slot (Menu.module.css .itemIcon).
    { id: 'archive', label: t('menu.archiveSession'), icon: <IconArchiveOutline20 size={16} />, danger: true },
  ]

  return (
    <>
      <Menu
        open={menuOpen}
        onClose={() => { setMenuOpen(false) }}
        items={menuItems}
        // Pinned session context above the verb rows (the running agent
        // preset on phone-sized viewports); an unoccupied hole renders none.
        header={renderSlot('conversation.session.header.utilities.menuHead', {})}
        onSelect={(id) => {
          setMenuOpen(false)
          if (id === 'pin') {
            setSessionPinned(sessionId, !pinned).catch((reason: unknown) => {
              console.warn('session pin update rejected:', reason)
            })
          }
          else if (id === 'rename') openRename(currentTitle)
          else if (id === 'fork') forkSession(sessionId)
          else if (id === 'move') openMove()
          else if (id === 'download') downloadSessionLog?.(sessionId)
          else if (id === 'archive') confirmArchive()
        }}
        align="end"
        portal
        closeOnPointerLeave
        anchor={(
          <button
            type="button"
            className={css.trigger}
            aria-label={t('actions.session.aria', { name: currentTitle })}
            onClick={() => { setMenuOpen(v => !v) }}
          >
            <IconEllipsisOutline16 />
          </button>
        )}
      />

      <Modal
        open={renameOpen}
        onClose={closeRename}
        closeLabel={t('close')}
        title={t('rename.session.title')}
        footer={(
          <>
            <Button variant="outline" disabled={renaming} onClick={closeRename}>{t('cancel')}</Button>
            <Button variant="primary" disabled={renaming || renameDraft.trim() === ''} onClick={confirmRename}>
              {t('rename')}
            </Button>
          </>
        )}
      >
        <input
          className={css.field}
          value={renameDraft}
          aria-label={t('field.sessionName')}
          autoFocus
          disabled={renaming}
          onFocus={(e) => { e.target.select() }}
          onChange={(e) => { setRenameDraft(e.target.value); setRenameError(null) }}
          onCompositionStart={() => { composingRef.current = true }}
          onCompositionEnd={() => { composingRef.current = false }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !composingRef.current) {
              e.preventDefault()
              confirmRename()
            }
          }}
        />
        {renameError !== null && <div className={css.error} role="alert">{renameError}</div>}
      </Modal>

      <Modal
        open={moveOpen}
        onClose={closeMove}
        closeLabel={t('close')}
        title={t('move.session.title')}
        footer={(
          <>
            <Button variant="outline" disabled={moving} onClick={closeMove}>{t('cancel')}</Button>
            <Button variant="primary" disabled={moving || moveTargetWorkspaceId === ''} onClick={confirmMove}>
              {t('move.button')}
            </Button>
          </>
        )}
      >
        <div className={css.moveBody}>
          <label className={css.moveLabel}>{t('move.targetWorkspace')}</label>
          <Select
            value={moveTargetWorkspaceId}
            onChange={(val) => { setMoveTargetWorkspaceId(val); setMoveError(null) }}
            options={workspaces.map(w => ({ value: w.workspaceId, label: w.title }))}
            placeholder={t('move.targetWorkspace')}
          />
          {moveError !== null && <div className={css.error} role="alert">{moveError}</div>}
        </div>
      </Modal>
    </>
  )
}
