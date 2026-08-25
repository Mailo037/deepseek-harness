// Queue dock entry: renders the authoritative transient inbox snapshot and
// addresses per-row mutations through the session-scoped conversation face.
// Row order edits (drag handle, keyboard arrows) commit as `move` actions;
// row text edits load the occurrence into the composer (queue-edit flow).
//
// The 'conversation.input.dock' SlotMap declaration lives in
// ../contract/slots.ts beside the other input-region slots.
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { DragEvent, KeyboardEvent } from 'react'
import { useEffect, useId, useMemo, useState } from 'react'
import clsx from 'clsx'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import {
  IconCloseOutline16, IconChevronDownOutline14, IconChevronUpOutline14,
  IconEditOutline16, IconGripOutline14, IconImageOutline14, IconQueueOutline14, IconSendOutline14,
  IconTrashOutline16, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { QueueAction, QueueItemId, QueueRow } from '../contract/queue.ts'
import { NS } from '../locales.ts'
import css from './QueueDock.module.css'

/** Queue operations injected by the session-scoped registration. */
export interface QueueDockInjected {
  updateQueue: (itemId: QueueItemId, action: QueueAction) => Promise<void>
  notify: (level: 'info' | 'error', text: string) => void
  /** Resolve a queued image attachment to a browser-owned URL. */
  loadImage: (attachment: ImageAttachmentRef) => Promise<string>
  /** Load one queued row into the composer for editing (stashes the draft). */
  beginQueueEdit: (itemId: QueueItemId) => boolean
  /** Leave composer-side editing and restore the stashed draft. */
  cancelQueueEdit: () => void
}

/**
 * Composer-side queue-edit verbs satisfied by the resident input shell
 * (structural: the dock never sees the shell type).
 */
interface QueueEditorFace {
  beginQueueEdit(itemId: QueueItemId): boolean
  cancelQueueEdit(): void
}

/** Full props of a dock entry: InputZone owner share + session standard kit + global seat + the locale seat. */
export type QueueDockProps = PropsRuntime<'conversation.input.dock'> & QueueDockInjected & PropsLocale<'conversation'>

type QueuePreviewPart =
  | { readonly kind: 'text'; text: string }
  | { readonly kind: 'image'; attachment: ImageAttachmentRef }

const IMAGE_MARKER = '[image]'

/** Append adjacent text to one part so truncation preserves inline image positions. */
function appendPreviewText(parts: QueuePreviewPart[], text: string): void {
  if (text === '') return
  const last = parts.at(-1)
  if (last?.kind === 'text') last.text += text
  else parts.push({ kind: 'text', text })
}

/**
 * Rebuild a QueueMirror preview with image blocks retained as semantic parts.
 * `row.preview` supplies the mirror's existing bounded text budget; each
 * retained image consumes its original textual marker only for that budget.
 */
function queuePreviewParts(row: QueueRow): QueuePreviewPart[] {
  const parts: QueuePreviewPart[] = []
  let hasContent = false
  let pendingSpace = false

  const appendText = (text: string): void => {
    for (const char of text) {
      if (/\s/u.test(char)) {
        if (hasContent) pendingSpace = true
        continue
      }
      if (pendingSpace) appendPreviewText(parts, ' ')
      pendingSpace = false
      appendPreviewText(parts, char)
      hasContent = true
    }
  }

  const appendImage = (attachment: ImageAttachmentRef): void => {
    if (pendingSpace) appendPreviewText(parts, ' ')
    pendingSpace = false
    parts.push({ kind: 'image', attachment })
    hasContent = true
  }

  for (const [index, block] of row.content.entries()) {
    if (index > 0) appendText(' ')
    if (block.type === 'text') appendText(block.text)
    else if (block.type === 'image') appendImage(block.attachment)
    // Merge-extensible blocks retain QueueMirror's textual fallback.
    else appendText(`[${block.type}]`)
  }

  const truncated = row.preview.endsWith('…')
  let remaining = Array.from(truncated ? row.preview.slice(0, -1) : row.preview).length
  const visible: QueuePreviewPart[] = []
  for (const part of parts) {
    if (remaining === 0) break
    if (part.kind === 'image') {
      if (remaining >= IMAGE_MARKER.length) {
        visible.push(part)
        remaining -= IMAGE_MARKER.length
      } else {
        appendPreviewText(visible, IMAGE_MARKER.slice(0, remaining))
        remaining = 0
      }
      continue
    }
    const chars = Array.from(part.text)
    appendPreviewText(visible, chars.slice(0, remaining).join(''))
    remaining = Math.max(0, remaining - chars.length)
  }
  if (truncated) appendPreviewText(visible, '…')
  return visible
}

/** One queued image thumbnail, with a neutral glyph until its attachment resolves. */
function QueueImagePreview({ attachment, loadImage, label }: {
  attachment: ImageAttachmentRef
  loadImage: (attachment: ImageAttachmentRef) => Promise<string>
  label: string
}) {
  const [src, setSrc] = useState<string>()

  useEffect(() => {
    let active = true
    setSrc(undefined)
    void loadImage(attachment).then(
      (url) => { if (active) setSrc(url) },
      () => { if (active) setSrc(undefined) },
    )
    return () => { active = false }
  }, [attachment, loadImage])

  if (src === undefined) {
    return <span className={css.imagePlaceholder} aria-hidden><IconImageOutline14 /></span>
  }
  return <img className={css.imagePreview} src={src} alt={attachment.name ?? label} draggable={false} />
}

/** Queue-row preview that replaces semantic image markers with loaded thumbnails. */
function QueuePreview({ row, loadImage, label }: {
  row: QueueRow
  loadImage: (attachment: ImageAttachmentRef) => Promise<string>
  label: string
}) {
  return (
    <>
      {queuePreviewParts(row).map((part, index) => (
        part.kind === 'image'
          ? <QueueImagePreview key={index} attachment={part.attachment} loadImage={loadImage} label={label} />
          : <span key={index}>{part.text}</span>
      ))}
    </>
  )
}

/**
 * Queue strip: one item renders directly; multiple items default to a
 * collapsible count header; an empty queue renders nothing. Rows carry a
 * drag handle (far left) whenever two or more rows can reorder.
 */
export function QueueDock({ useSession, input, updateQueue, notify, loadImage, beginQueueEdit, cancelQueueEdit, t }: QueueDockProps) {
  const inbox = useSession(s => s.queue)
  const queue = useMemo(() => inbox.filter(row => row.placement === 'queued'), [inbox])
  const running = useSession(s => s.running)
  const queueMutable = useSession(s => s.subagent === null)
  const [busy, setBusy] = useState<QueueItemId | null>(null)
  const [collapsed, setCollapsed] = useState(true)
  const [drag, setDrag] = useState<{ id: QueueItemId; from: number } | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const listId = useId()
  const queueEditId = input.queueEdit?.itemId
  const canReorder = queueMutable && queue.length > 1 && busy === null

  useEffect(() => {
    if (queue.length === 0 && !collapsed) setCollapsed(true)
    if (drag !== null && !queue.some(row => row.id === drag.id)) {
      setDrag(null)
      setDropIndex(null)
    }
  }, [collapsed, drag, queue])

  if (queue.length === 0) return null

  const interactionActive = queueMutable && (busy !== null || queueEditId !== undefined)
  const expanded = !collapsed || interactionActive
  const listVisible = queue.length === 1 || expanded

  const applyAction = async (
    itemId: QueueItemId,
    action: QueueAction,
    failure: string,
  ): Promise<boolean> => {
    setBusy(itemId)
    try {
      await updateQueue(itemId, action)
      return true
    } catch {
      notify('error', failure)
      return false
    } finally {
      setBusy(current => current === itemId ? null : current)
    }
  }

  /** Commit one drop/keyboard reorder through the authoritative move verb. */
  const moveRow = (itemId: QueueItemId, from: number, toIndex: number): void => {
    setDrag(null)
    setDropIndex(null)
    if (toIndex === from) return
    void applyAction(itemId, { kind: 'move', toIndex }, t('queue.moveFailed'))
  }

  const onDragStart = (row: (typeof queue)[number], index: number) => (event: DragEvent<HTMLLIElement>): void => {
    if (!canReorder) return
    // jsdom fires synthetic drag events without a DataTransfer; guard the reads.
    const transfer = event.dataTransfer as DataTransfer | undefined
    transfer?.setData('text/plain', String(index))
    if (transfer !== undefined) transfer.effectAllowed = 'move'
    setDrag({ id: row.id, from: index })
  }

  const onDragOver = (row: (typeof queue)[number], index: number) => (event: DragEvent<HTMLLIElement>): void => {
    if (drag === null || drag.id === row.id) return
    event.preventDefault()
    const transfer = event.dataTransfer as DataTransfer | undefined
    if (transfer !== undefined) transfer.dropEffect = 'move'
    setDropIndex(index)
  }

  const onDragEnd = (): void => {
    setDrag(null)
    setDropIndex(null)
  }

  const onHandleKeyDown = (row: (typeof queue)[number], index: number) => (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'ArrowUp' && index > 0) {
      event.preventDefault()
      moveRow(row.id, index, index - 1)
      return
    }
    if (event.key === 'ArrowDown' && index < queue.length - 1) {
      event.preventDefault()
      moveRow(row.id, index, index + 1)
    }
  }

  return (
    <div className={css.dock} data-queue-dock="">
      <div className={css.panel}>
        {queue.length > 1 && (
          <button
            type="button"
            className={css.header}
            aria-controls={listId}
            aria-expanded={expanded}
            disabled={interactionActive}
            onClick={() => { setCollapsed(value => !value) }}
          >
            <span className={css.lead} aria-hidden><IconQueueOutline14 /></span>
            <span className={css.count}>{t('queue.count', { n: queue.length })}</span>
            <span className={css.chevron} aria-hidden>
              {expanded ? <IconChevronDownOutline14 /> : <IconChevronUpOutline14 />}
            </span>
          </button>
        )}
        <ul id={listId} className={css.list} hidden={!listVisible}>
          {listVisible && queue.map((row, index) => {
            const editingThisRow = queueEditId === row.id
            const dropMark = drag !== null && drag.id !== row.id && dropIndex === index
            return (
              <li
                key={row.id}
                className={clsx(
                  css.row,
                  drag?.id === row.id && css.rowDragging,
                  dropMark && (index < (drag?.from ?? index) ? css.dropAbove : css.dropBelow),
                )}
                data-queue-row=""
                draggable={canReorder}
                onDragStart={onDragStart(row, index)}
                onDragOver={onDragOver(row, index)}
                onDrop={(event) => {
                  if (drag === null) return
                  event.preventDefault()
                  moveRow(drag.id, drag.from, index)
                }}
                onDragEnd={onDragEnd}
              >
                {/* Single-item strip has no count header, so the row itself carries the queue glyph. */}
                {queue.length === 1
                  ? <span className={css.lead} aria-hidden><IconQueueOutline14 /></span>
                  : queueMutable && (
                    <Tooltip label={t('queue.reorder')} side="bottom" delayMs={500}>
                      <button
                        type="button"
                        className={css.drag}
                        aria-label={t('queue.reorder')}
                        disabled={busy !== null}
                        onKeyDown={onHandleKeyDown(row, index)}
                      >
                        <IconGripOutline14 />
                      </button>
                    </Tooltip>
                  )}
                <span className={clsx(css.preview, editingThisRow && css.previewEditing)}>
                  {row.content.some(block => block.type === 'image')
                    ? <QueuePreview row={row} loadImage={loadImage} label={t('image.label')} />
                    : row.preview}
                </span>
                {queueMutable && <div className={css.actions}>
                  {editingThisRow
                    ? (
                      <Tooltip label={t('queue.cancelEdit')} side="bottom" delayMs={500}>
                        <button
                          type="button"
                          className={css.action}
                          aria-label={t('queue.cancelEdit')}
                          disabled={busy !== null}
                          onClick={() => { cancelQueueEdit() }}
                        >
                          <IconCloseOutline16 size={14} />
                        </button>
                      </Tooltip>
                    )
                    : (
                      <Tooltip label={t('queue.edit')} side="bottom" delayMs={500} disabled={row.text === null}>
                        <button
                          type="button"
                          className={css.action}
                          aria-label={t('queue.edit')}
                          // Disabled buttons fire no hover events, so the
                          // unsupported hint stays a native title.
                          title={row.text === null ? t('queue.edit.unsupported') : undefined}
                          disabled={busy !== null || row.text === null}
                          onClick={() => { beginQueueEdit(row.id) }}
                        >
                          <IconEditOutline16 size={14} />
                        </button>
                      </Tooltip>
                    )}
                  <Tooltip label={t('queue.remove')} side="bottom" delayMs={500}>
                    <button
                      type="button"
                      className={css.action}
                      aria-label={t('queue.remove')}
                      disabled={busy !== null}
                      onClick={() => {
                        void applyAction(
                          row.id,
                          { kind: 'remove' },
                          t('queue.removeFailed'),
                        )
                      }}
                    >
                      <IconTrashOutline16 size={14} />
                    </button>
                  </Tooltip>
                  <Tooltip label={t('queue.steer')} side="bottom" delayMs={500} disabled={!running}>
                    <button
                      type="button"
                      className={css.action}
                      aria-label={t('queue.steer')}
                      title={running ? undefined : t('queue.steer.unavailable')}
                      disabled={busy !== null || !running}
                      onClick={() => {
                        void applyAction(
                          row.id,
                          { kind: 'steer' },
                          t('queue.steerFailed'),
                        )
                      }}
                    >
                      <IconSendOutline14 />
                    </button>
                  </Tooltip>
                </div>}
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

/**
 * The dock entry as a plain registrant plugin. The conversation service is
 * the action contract; the slot declaration has an independent lifecycle boundary.
 */
export const queueDockEntry = {
  name: 'conversation-queue-dock',
  inject: ['slots', 'conversation', 'sessions'],
  /**
   * Register the queue strip as the terminal input-dock entry (order 20).
   * @param ctx - registrant context (disposal rides ctx.effect inside slots.register).
   */
  apply(ctx: Context): void {
    ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
      name: 'conversation.input.dock',
      id: 'queue',
      order: 20,
      locale: NS,
      inject: (sessionId: SessionId): QueueDockInjected => {
        const actx = ctx.sessions.scope(sessionId)
        if (actx === undefined) throw new Error(`queue dock: session "${sessionId}" resolved no scope`)
        const conversation = actx.get('conversation')
        if (conversation === undefined) throw new Error('queue dock: conversation service unavailable')
        const input = conversation.input.for(actx) as ReturnType<typeof conversation.input.for> & QueueEditorFace
        return {
          updateQueue: (itemId, action) => conversation.updateQueue(itemId, action),
          notify: (level, text) => { conversation.input.for(actx).notify(level, text) },
          loadImage: attachment => conversation.resolveImage(sessionId, attachment),
          beginQueueEdit: itemId => input.beginQueueEdit(itemId),
          cancelQueueEdit: () => { input.cancelQueueEdit() },
        }
      },
    }, QueueDock))
  },
}
