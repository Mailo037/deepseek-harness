/** The default composer body: the 'conversation.composer.bar' slot entry.
 * Machine state arrives through the standard provide channel
 * (useInput + inputActions); the keyboard/DOM command face and stop arrive
 * through this entry's own inject, whose hooks compartment binds
 * useNotices/useLexicon; layout-phase inputs (variant, placeholder,
 * region-slot content) ride the owner props. Session facts
 * (running/removed/promptError) are self-selected via useSession. */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, KeyboardEvent, MouseEvent, ReactNode } from 'react'
import clsx from 'clsx'
import {
  IconCloseOutline16, IconPaperclipOutline16, IconPlusOutline16, IconQueueOutline14, IconWarningOutline16,
  FileTypeIcon, fileTypeIconKind, Menu, Toast, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: the `plan` projection key merge (the TodoDock posture — the
// composer reads a host-computed value; the domain owns the key).
import type {} from '@deepseek-ai/dsh-plan-mode/client'
// Type-only: the `goal` projection key merge (hint disambiguation).
import type {} from '@deepseek-ai/dsh-goal/client'
// The `imageLimits` projection key merge (intake pre-check) arrives with the
// wire types: apiproxy's sessions contract declares it, and client-runtime's
// api-remotes import already places it in every client program.
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { ComposerBarProps } from '../contract/slots.ts'
import { deriveDecorations } from '../input/decorations.ts'
import type { DraftDecorations } from '../input/decorations.ts'
import type { DraftAttachmentId } from '../input/contract.ts'
import { attachmentErrorText, imageSizeText } from '../image-labels.ts'
import { isImageMediaType, LARGE_PASTE_CHARS } from '../service.ts'
import { ReferenceIcon } from '../reference/ReferenceIcon.tsx'
import { ContextMeter } from './ContextMeter.tsx'
import { PermissionSelect } from './PermissionSelect.tsx'
import { isSafariBrowser, repairSafariTextareaLayout } from './safari.ts'
import css from './InputBar.module.css'

/** Decoration product of the no-session state (no machine, empty draft). */
const INERT_DECORATIONS: DraftDecorations = { token: null, chips: [], textRefs: [], hint: null }

/**
 * Format a token string for display: strips leading trigger character (/ or @),
 * replaces dashes/underscores with spaces, and capitalizes word boundaries (Title Case).
 * @param raw - raw token string (e.g. '/dsh-doc-site-sync' or '@src/file.ts').
 * @returns formatted human-readable label.
 */
export function formatTokenLabel(raw: string): string {
  const clean = raw.replace(/^[/@]/u, '')
  if (clean === '') return raw
  if (clean.includes('/') || clean.includes('\\')) {
    return clean
  }
  return clean
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

export type InputBarProps = ComposerBarProps

export function InputBar({
  useSession, useInput, inputActions, keyboard, addFiles, addTextAttachment, removeAttachment, draftAttachments,
  resolveSubmitMode, stop, command, t,
  renderSlot, useNotices, useLexicon, useMenuLauncher,
  useProjection, sessionId, variant, disabled: inert = false, blocked,
  workspacePickerOpen = false, onRequestWorkspace,
  placeholder, accessory, overlay, leftItems, rightItems, footer,
}: InputBarProps) {
  const input = useInput(s => s)
  const notice = useNotices(s => s)
  const lexicon = useLexicon(s => s)
  const commandMenuOpen = useMenuLauncher(source => source === 'command')
  const promptError = useSession(s => s.promptError) ?? null
  const running = useSession(s => s.running) ?? false
  const subagent = useSession(s => s.subagent) ?? null
  const removed = useSession(s => s.removed) ?? false
  // Plan mode swaps the textarea placeholder (the projection is the folded
  // host value; owner-prop placeholders — hero, session-unavailable — win).
  const planActive = useProjection('plan', plan => plan !== undefined && (plan.pending ? !plan.active : plan.active))
  // Absent (undefined: no frame yet) and cleared (null) both mean no goal.
  const hasGoal = useProjection('goal', goal => goal != null)
  // Session-maybe: the machine faces are absent together while no session is
  // current; the bar renders the same DOM inert instead of a parallel tree.
  const live = input !== undefined && keyboard !== undefined && inputActions !== undefined
  const draft = input?.draft ?? ''
  // Composer-side queue edit (the queue dock's edit flow): the draft IS the
  // pending occurrence until submit saves it in place or Escape restores.
  const queueEditItem = input?.queueEdit?.itemId
  const attachments = useMemo(
    () => input === undefined || draftAttachments === undefined ? [] : draftAttachments(input.attachmentIds),
    [draftAttachments, input?.attachmentIds],
  )
  const empty = draft.trim() === '' && attachments.length === 0
  // Transient error banner (machine notices, image-intake rejections, and
  // prompt failures): the seq keys the Toast so an identical repeated message
  // restarts the hold-then-fade cycle instead of reusing the faded one.
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)
  const toastSeq = useRef(0)
  const showToast = useCallback((text: string) => {
    toastSeq.current += 1
    setToast({ seq: toastSeq.current, text })
  }, [])
  const dismissToast = useCallback(() => { setToast(null) }, [])
  // The deployment's image-intake limits (absent while no attachment service
  // is composed — the pre-check below then defers entirely to the host).
  const imageLimits = useProjection('imageLimits')
  // Prompt failures are ordinary failures (no create/attach transaction exists
  // anymore): the toast announces promptError, the draft stays in the machine,
  // and the user resubmits. A remount over a session whose machine still holds
  // an unresolved promptError deliberately re-announces it once — the failure
  // is still pending, and a transient banner is its only surface. Attachment
  // rejections show product copy keyed by the wire reason; other codes are
  // developer-facing and keep the raw message plus code.
  useEffect(() => {
    if (promptError === null) return
    showToast(promptError.error.code === 'attachment-error'
      ? attachmentErrorText(t, promptError.error.details.reason, imageLimits)
      : `${promptError.error.message} (${promptError.error.code})`)
  }, [promptError, showToast, t, imageLimits])
  useEffect(() => {
    if (notice?.level === 'error') showToast(notice.text)
  }, [notice, showToast])
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const mirrorRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  // The plus button's attachment context menu (upload entry; more later).
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const safari = useMemo(() => isSafariBrowser(navigator), [])
  const safariNativeShrinkRef = useRef(false)
  // IME guard: composition Enter picks a candidate, it must not send. The ref outlives renders;
  // clearing is deferred one tick because Safari delivers the closing keydown AFTER compositionend.
  const composingRef = useRef(false)
  const onCompositionStart = (): void => {
    composingRef.current = true
  }
  const onCompositionEnd = (): void => {
    setTimeout(() => {
      composingRef.current = false
    }, 10)
  }

  // The Access seat's data: the host-computed permissions projection
  // (undefined = capability absent → the chip renders nothing).
  const permissions = useProjection('permissions')

  // A continuable child without its live parent cannot accept human input,
  // but its independent Stop below stays available while it runs.
  const continuable = subagent?.address.mode === 'continuable'
  const parentOffline = continuable && !subagent.parentAvailable
  // Running input stays free; locked = session removed, the
  // inert no-workspace state, the machine faces absent (no session), or a
  // parent-offline continuable child. An owner block also disables input;
  // adjudicating and submitting render read-only so the draft stays visible.
  const disabled = removed || inert || !live || blocked !== undefined || parentOffline
  const locked = disabled
  // The model seat is the ONE control a block leaves live: every block this
  // contract has is cleared by choosing a model, so locking it too would leave
  // the composer asking for the only thing it prevents. The other reasons to
  // be disabled do lock it — there is no session to choose a model for.
  const modelSeatLocked = removed || inert || !live
  const machineBusy = input?.phase === 'adjudicating' || input?.phase === 'submitting'
  // The no-workspace textarea remains the resident DOM node but acts as the
  // existing picker trigger. Message controls stay locked until a Session
  // exists; the trigger itself is read-only rather than disabled so pointer
  // and keyboard users can reach the recovery action.
  const workspaceTrigger = inert && !removed && onRequestWorkspace !== undefined
  const textareaDisabled = removed || (locked && !workspaceTrigger)
  const canSteerQueue = !locked && !machineBusy && !commandMenuOpen && empty && running && subagent === null
    && queueEditItem === undefined
    && input.queue.some(row => row.placement === 'queued')

  useEffect(() => {
    if (input === undefined || inputActions === undefined) return
    if (attachments.length !== input.attachmentIds.length) {
      inputActions.pruneAttachments(attachments.map(attachment => attachment.id))
    }
  }, [attachments, input?.attachmentIds, inputActions])

  // A native Safari edit that shortens the draft may leave the previous
  // soft-wrap layout behind after the mirror shrinks. The native-change signal
  // keeps ordinary typing and programmatic draft updates from reading layout;
  // the helper then repairs only measured overflow before paint while
  // preserving native editing state. See
  // .agents/notes/implemented/bug-fix/2026-08-13-safari-textarea-soft-wrap-reflow.md.
  useLayoutEffect(() => {
    const nativeShrink = safariNativeShrinkRef.current
    safariNativeShrinkRef.current = false
    if (safari && nativeShrink) repairSafariTextareaLayout(inputRef.current)
  }, [draft, safari])
  // Scroll the draft scrollport the minimum that brings `caret` into view — the
  // browser's own behavior for typing, performed for the paths where it does
  // not act.
  //
  // The mirror is the caret's ruler: it renders the same draft at the same
  // metrics and the same wrap width in the same stack (that is what makes it
  // the height authority), so a Range collapsed at the caret's index reports
  // where the caret is without a caret API.
  const revealCaret = (caret: number): void => {
    const scrollEl = scrollRef.current
    const mirrorEl = mirrorRef.current
    const text = mirrorEl?.firstChild
    if (scrollEl === null || mirrorEl === null || !(text instanceof Text)) return
    // A box that cannot scroll has nothing to reveal: the draft fits, so every
    // caret is already in view and the assignment below would clamp to itself.
    if (scrollEl.scrollHeight <= scrollEl.clientHeight) return
    const at = Math.min(caret, text.data.length)
    // A caret straight after a newline sits on a line with nothing on it to
    // measure — the shape a trailing-newline draft ends in — and the engines
    // disagree there: chromium returns NO client rects at all (an all-zero box,
    // which would scroll the wrong way), firefox reports the line above, WebKit
    // the right one. Measure the newline itself instead, which is the line the
    // caret just left, and step one line down; that they all agree on.
    const afterNewline = at > 0 && text.data[at - 1] === '\n'
    const range = document.createRange()
    range.setStart(text, afterNewline ? at - 1 : at)
    if (afterNewline) range.setEnd(text, at)
    else range.collapse(true)
    const line = afterNewline ? Number.parseFloat(getComputedStyle(mirrorEl).lineHeight) : 0
    const rect = range.getBoundingClientRect()
    const box = scrollEl.getBoundingClientRect()
    if (rect.bottom + line > box.bottom) scrollEl.scrollTop += rect.bottom + line - box.bottom
    else if (rect.top + line < box.top) scrollEl.scrollTop -= box.top - rect.top - line
  }

  // Reveal the focus end of the current selection. Today's entry paths leave a
  // collapsed selection, but honoring direction keeps a future range-preserving
  // path from revealing its anchor instead of its focus.
  const revealSelectionFocus = (el: HTMLTextAreaElement): void => {
    // selectionStart/End are number|null in lib.dom; the type-aware lint program narrows them.
    const caret = el.selectionDirection === 'backward' ? el.selectionStart : el.selectionEnd
    // oxlint-disable-next-line typescript/no-unnecessary-condition
    revealCaret(caret ?? el.value.length)
  }

  // Unlock (mount / session switch) returns focus to the box, and owns the
  // reveal that comes with it. `preventScroll` because this focus is ours, not
  // a gesture: the textarea is as tall as the draft, so the browser's reveal
  // would walk up to the conversation scrollport and move the transcript under
  // a user who only switched session. That leaves the caret to us — the DOM is
  // reused across sessions, so switching to a longer draft keeps the previous
  // offset while the value swap puts the caret at the new draft's end, which is
  // off screen (measured on all three engines: offset 0 with the caret 940px
  // down). Suppress the walk, then reveal in our own box. Coarse-pointer
  // (touch) devices skip the focus entirely — a programmatic focus there
  // raises the soft keyboard over a chat the user only opened; the reveal
  // still runs, so switching to a longer draft still lands at its end.
  const coarsePointer = useMemo(
    // jsdom implements no matchMedia: the optional call keeps that lane on
    // the desktop path.
    () => window.matchMedia?.('(pointer: coarse)').matches ?? false,
    [],
  )
  useEffect(() => {
    const el = inputRef.current
    if (locked || coarsePointer || el === null) return
    el.focus({ preventScroll: true })
    revealSelectionFocus(el)
  }, [locked, sessionId, coarsePointer])

  // A persisted draft arrives AFTER the unlock effect: ConversationSession
  // adopts it in its own mount effect, and a parent's mount effect runs after
  // its children's. Reveal when the draft becomes non-empty so a restored long
  // draft does not stay at its head with the caret at its end. This effect does
  // not focus: send-clear, failed-send restore, and first-character transitions
  // must not steal focus from another control the user moved to.
  useEffect(() => {
    const el = inputRef.current
    if (locked || draft === '' || el === null) return
    revealSelectionFocus(el)
  }, [draft !== ''])

  // Caret restore after an edit the composer performs itself. The machine owns
  // the draft and the undo log, so paste and cut suppress the native edit and
  // write the value through the machine — and a
  // programmatic selection change reveals nothing: measured in chromium and
  // WebKit, pasting a long block leaves the view where it was while the caret
  // sits at the end of the draft. Native typing gets its reveal from the
  // browser; these two have to ask for it, so they share one restore.
  const restoreCaret = (el: HTMLTextAreaElement, caret: number): void => {
    requestAnimationFrame(() => {
      el.setSelectionRange(caret, caret)
      revealCaret(caret)
    })
  }

  // Wheel chaining on the draft scrollport, one lifetime (it is never
  // unmounted — the inert state renders the same element disabled). While the
  // capped box can still move in this direction, keep the native scroll; only
  // at its own edge forward the delta to the active conversation scrollport, so
  // a short draft never traps the gesture and a long draft stays scrollable.
  // Hero mounts have no host and keep native wheel scrolling.
  useEffect(() => {
    const el = scrollRef.current
    if (el === null) return
    const onWheel = (e: WheelEvent): void => {
      const host = el.closest('[data-conversation-scroll]')
      if (!(host instanceof HTMLElement) || e.deltaY === 0) return
      const atTop = el.scrollTop <= 0
      const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 1
      if ((e.deltaY < 0 && !atTop) || (e.deltaY > 0 && !atEnd)) return
      e.preventDefault()
      host.scrollTop += e.deltaY
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => { el.removeEventListener('wheel', onWheel) }
  }, [])

  // selectionStart/End are number|null in lib.dom; the type-aware lint program narrows them.
  /* oxlint-disable typescript/no-unnecessary-condition */
  const selectionOf = (el: HTMLTextAreaElement) => ({
    start: el.selectionStart ?? 0,
    end: el.selectionEnd ?? el.selectionStart ?? 0,
  })
  /* oxlint-enable typescript/no-unnecessary-condition */

  const [hoveredKey, setHoveredKey] = useState<string | null>(null)
  const backdropRef = useRef<HTMLDivElement | null>(null)

  // Mirror-layer decorations: a visible backdrop with transparent textarea
  // text. Claim tokens and references retain the draft's own glyph metrics,
  // so their decoration cannot drift from wrapping, selection, or the caret.
  const deco = input === undefined ? INERT_DECORATIONS : deriveDecorations(input, lexicon)

  const allTokenRanges = useMemo(() => {
    if (input === undefined) return []
    const ranges: { start: number; end: number; key: string }[] = []
    if (deco.token !== null) {
      ranges.push({ start: deco.token.start, end: deco.token.end, key: 'token' })
    }
    for (const chip of deco.chips) {
      ranges.push({ start: chip.offset, end: chip.offset + chip.length, key: `chip-${chip.occurrenceId}` })
    }
    for (const ref of deco.textRefs) {
      ranges.push({ start: ref.start, end: ref.end, key: `ref-${ref.start}` })
    }
    return ranges.sort((a, b) => a.start - b.start)
  }, [deco, input])

  const snapCaretOutOfTokens = (el: HTMLTextAreaElement): void => {
    const sel = selectionOf(el)
    if (sel.start !== sel.end) return
    const caret = sel.start
    for (const range of allTokenRanges) {
      if (caret > range.start && caret < range.end) {
        const snapTo = caret - range.start < range.end - caret ? range.start : range.end
        el.setSelectionRange(snapTo, snapTo)
        return
      }
    }
  }

  const onMouseMove = (e: React.MouseEvent<HTMLTextAreaElement>): void => {
    const backdropEl = backdropRef.current
    if (backdropEl === null) return
    const tokenEls = backdropEl.querySelectorAll<HTMLElement>('[data-decoration]')
    let foundKey: string | null = null
    for (const el of tokenEls) {
      const rect = el.getBoundingClientRect()
      if (
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom
      ) {
        foundKey = el.dataset.tokenKey ?? null
        break
      }
    }
    setHoveredKey(prev => prev === foundKey ? prev : foundKey)
  }

  const onMouseLeave = (): void => {
    setHoveredKey(null)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (workspaceTrigger) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onRequestWorkspace()
      }
      return
    }
    // Absent machine without a Workspace recovery action stays disabled; the
    // guard narrows the faces for the paths below.
    if (input === undefined || keyboard === undefined || inputActions === undefined) return
    // Shift+Enter is the native newline UNCONDITIONALLY — decided before the
    // IME guard so a composition-closing Shift+Enter still breaks the line.
    if (e.key === 'Enter' && e.shiftKey) return
    // keyCode 229 is the legacy IME-composition signal engines emit without isComposing.
    // oxlint-disable-next-line typescript/no-deprecated
    const composing = composingRef.current || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229
    if (e.key === 'ArrowLeft' && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
      const selection = selectionOf(e.currentTarget)
      if (selection.start === selection.end) {
        const caret = selection.start
        const token = allTokenRanges.find(r => caret > r.start && caret <= r.end)
        if (token !== undefined) {
          e.preventDefault()
          restoreCaret(e.currentTarget, token.start)
          return
        }
      }
    }
    if (e.key === 'ArrowRight' && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
      const selection = selectionOf(e.currentTarget)
      if (selection.start === selection.end) {
        const caret = selection.start
        const token = allTokenRanges.find(r => caret >= r.start && caret < r.end)
        if (token !== undefined) {
          e.preventDefault()
          restoreCaret(e.currentTarget, token.end)
          return
        }
      }
    }
    if (!composing && !machineBusy && !locked
      && (e.key === 'Backspace' || e.key === 'Delete')) {
      const selection = selectionOf(e.currentTarget)
      if (selection.start === selection.end) {
        const caret = selection.start
        const token = allTokenRanges.find(r => e.key === 'Backspace'
          ? (r.end === caret || (r.end < draft.length && draft[r.end] === ' ' && r.end + 1 === caret) || (caret > r.start && caret <= r.end))
          : (r.start === caret || (caret >= r.start && caret < r.end)))
        if (token !== undefined) {
          e.preventDefault()
          const start = token.start
          let end = token.end
          if (end < draft.length && draft[end] === ' ') end += 1
          keyboard.setDraft(draft.slice(0, start) + draft.slice(end), { start, end, insertedLength: 0 })
          restoreCaret(e.currentTarget, start)
          keyboard.track(keyboard.snapshot.draft, start)
          return
        }
      }
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      if (keyboard.arbitrate(e.key === 'ArrowUp' ? 'up' : 'down', composing) === 'consumed') e.preventDefault()
      return
    }
    if (e.key === 'Escape') {
      // Queue edit first: Escape leaves the composer-side edit and restores
      // the stashed draft (the dock row keeps its pending position).
      if (queueEditItem !== undefined) {
        e.preventDefault()
        keyboard.cancelQueueEdit()
        return
      }
      // Escape layering: an open overlay closes; claimed without an overlay
      // does NOT release (backspacing the token is the only exit gesture).
      keyboard.dismissPopup()
      if (keyboard.arbitrate('escape', composing) === 'consumed') e.preventDefault()
      return
    }
    if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z' || e.key === 'y')) {
      // The machine owns the undo/redo log (chip transactions have semantics
      // the browser stack cannot represent); never let the native stack run.
      e.preventDefault()
      if (machineBusy || locked) return
      const redo = e.key === 'y' || e.shiftKey
      if (redo) keyboard.redo()
      else keyboard.undo()
      return
    }
    if (e.key === ' ') {
      if (composing) return
      if (keyboard.space()) e.preventDefault() // claim token already carries the trailing separator
      return
    }
    if (e.key !== 'Enter') return
    if (composing) return
    // Menu-open Enter picks the highlight through arbitration; a no-highlight
    // menu passes down to the machine's own adjudication.
    const arbitrated = keyboard.arbitrate('enter', composing)
    if (arbitrated !== 'pass') {
      e.preventDefault()
      return
    }
    e.preventDefault()
    if (e.repeat) return // held-down Enter must not machine-gun sends
    if (locked || machineBusy) return
    const accelerated = e.ctrlKey || e.metaKey
    // Empty-draft accelerated Enter acts on the queue instead of the (empty)
    // draft: the machine rejects empty drafts, so the gesture steers every
    // still-pending queued message into the running turn (the dock's per-row
    // steer button applied to the whole queue). Steering needs the same
    // window as the per-row button: a running ordinary session.
    if (accelerated && canSteerQueue) {
      keyboard.steerQueue()
      return
    }
    keyboard.submit(resolveSubmitMode(
      running,
      accelerated ? 'accelerated' : 'enter',
      subagent === null,
    ))
  }

  const onChange = (e: ChangeEvent<HTMLTextAreaElement>): void => {
    if (keyboard === undefined || locked) return // disabled/read-only states cannot edit the draft
    if (machineBusy) return // submitting is the read-only span; adjudicating holds the pending lock
    const next = e.target.value
    safariNativeShrinkRef.current = safari && next.length < draft.length
    keyboard.setDraft(next)
    // selectionStart is number|null in lib.dom; the type-aware lint program narrows it.
    // oxlint-disable-next-line typescript/no-unnecessary-condition
    keyboard.track(next, e.target.selectionStart ?? next.length)
  }

  const onCopyOrCut = (e: React.ClipboardEvent<HTMLTextAreaElement>, cut: boolean): void => {
    if (input === undefined || keyboard === undefined) return // absent machine: no draft can be copied or cut
    const el = e.currentTarget
    const { start, end } = selectionOf(el)
    if (start === end) return
    const touched = input.occurrences.filter(o => o.offset < end && o.offset + o.length > start)
    if (touched.length === 0 && !cut) return // plain copy of plain text: native path is fine
    e.preventDefault()
    const copyStart = touched.reduce((value, o) => Math.min(value, o.offset), start)
    const copyEnd = touched.reduce((value, o) => Math.max(value, o.offset + o.length), end)
    // Expand structured ranges to their owner clipboard projections.
    let text = ''
    let cursor = copyStart
    for (const o of touched) {
      text += draft.slice(cursor, o.offset) + o.clipboardText
      cursor = o.offset + o.length
    }
    text += draft.slice(cursor, copyEnd)
    e.clipboardData.setData('text/plain', text)
    if (cut && !machineBusy && !locked) {
      keyboard.setDraft(
        draft.slice(0, copyStart) + draft.slice(copyEnd),
        { start: copyStart, end: copyEnd, insertedLength: 0 },
      )
      restoreCaret(el, copyStart)
    }
  }

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    if (keyboard === undefined) return // absent machine: no draft can accept a paste
    if (machineBusy || locked) return
    const files = Array.from(e.clipboardData.items)
      .filter(item => item.kind === 'file')
      .map(item => item.getAsFile())
      .filter((file): file is File => file !== null)
    if (files.length > 0) intakeFiles(files)
    const text = e.clipboardData.getData('text/plain')
    if (text === '') {
      if (files.length > 0) e.preventDefault()
      return
    }
    e.preventDefault()
    // A very large paste becomes a restorable text attachment instead of a
    // draft-sized blob: the rail chip carries the content, and its restore
    // control puts it back into the draft at the caret.
    if (text.length >= LARGE_PASTE_CHARS && addTextAttachment !== undefined) {
      const rejection = addTextAttachment(nextPastedName(), text)
      if (rejection !== null) showToast(rejection)
      return
    }
    const el = e.currentTarget
    const sel = selectionOf(el)
    // Sync components stay empty at this layer: hot-snapshot matching needs
    // the Slash roster, which lives behind keyboard.track — the paste attempt
    // opens in the machine and the controller upgrades tokens as matches
    // land (paste-upgrade). The DOM layer only starts the transaction.
    keyboard.pasteBegin(text, sel)
    const caret = sel.start + text.length
    restoreCaret(el, caret)
    keyboard.track(keyboard.snapshot.draft, caret)
  }

  /** Next non-colliding name for a converted paste attachment. */
  const nextPastedName = (): string => {
    const taken = new Set(attachments.map(a => a.kind === 'image' ? '' : a.name))
    if (!taken.has('pasted-text.txt')) return 'pasted-text.txt'
    let n = 2
    while (taken.has(`pasted-text-${String(n)}.txt`)) n += 1
    return `pasted-text-${String(n)}.txt`
  }

  /**
   * Put one converted paste back into the draft: splice its content over the
   * current selection as one machine transaction, drop the attachment, and
   * hand focus and the caret back to the textarea.
   */
  const restoreTextAttachment = (id: DraftAttachmentId): void => {
    const attachment = attachments.find(candidate => candidate.id === id)
    if (keyboard === undefined || attachment === undefined || attachment.kind !== 'text') return
    const el = inputRef.current
    const sel = el !== null ? selectionOf(el) : { start: draft.length, end: draft.length }
    keyboard.setDraft(
      draft.slice(0, sel.start) + attachment.content + draft.slice(sel.end),
      { start: sel.start, end: sel.end, insertedLength: attachment.content.length },
    )
    removeAttachment?.(id)
    el?.focus({ preventScroll: true })
    if (el !== null) restoreCaret(el, sel.start + attachment.content.length)
    keyboard.track(keyboard.snapshot.draft, sel.start + attachment.content.length)
  }

  // Intake pre-check (DeepSeek Chat semantics): an addition that would break
  // a projected limit is refused as a whole batch, announced immediately, and
  // never enters the rail — no more submit-time failure rolling the rail
  // back. The host enforces the same limits at submit for callers that bypass
  // this composer. Non-image files skip the image limits entirely and ride
  // the injected file path (inline text or workspace upload).
  const intakeFiles = useCallback((files: readonly File[]): void => {
    if (addFiles === undefined || files.length === 0) return
    const images = files.filter(file => isImageMediaType(file.type))
    const others = files.filter(file => !isImageMediaType(file.type))
    if (others.length > 0) {
      void addFiles(others).then((rejected) => {
        if (rejected !== null) showToast(rejected)
      }, (error: unknown) => {
        showToast(error instanceof Error ? error.message : String(error))
      })
    }
    if (images.length === 0) return
    const rejection = (async (): Promise<string | null> => {
      if (imageLimits !== undefined) {
        // Format precedes limits (DeepSeek Chat's filter order): a batch with
        // a non-image must announce the format problem, not a count or size
        // it could never pass anyway — addFiles rejects it authoritatively.
        if (images.some(file => !(imageLimits.mediaTypes as readonly string[]).includes(file.type))) {
          return addFiles(images)
        }
        const draftImages = attachments.filter(a => a.kind === 'image')
        if (draftImages.length + images.length > imageLimits.maxImagesPerMessage) {
          return t('image.tooMany', { count: imageLimits.maxImagesPerMessage })
        }
        if (images.some(file => file.size > imageLimits.maxImageBytes)) {
          return t('image.fileTooLarge', { size: imageSizeText(imageLimits.maxImageBytes) })
        }
        const total = draftImages.reduce((sum, attachment) => sum + attachment.file.size, 0)
          + images.reduce((sum, file) => sum + file.size, 0)
        if (total > imageLimits.maxMessageImageBytes) {
          return t('image.totalTooLarge', { size: imageSizeText(imageLimits.maxMessageImageBytes) })
        }
      }
      return addFiles(images)
    })()
    void rejection.then((rejected) => {
      if (rejected !== null) showToast(rejected)
    }, (error: unknown) => {
      showToast(error instanceof Error ? error.message : String(error))
    })
  }, [addFiles, attachments, imageLimits, showToast, t])

  const canAcceptDrop = !locked && !machineBusy && addFiles !== undefined

  const onSelect = (e: React.SyntheticEvent<HTMLTextAreaElement>): void => {
    // Any caret/selection gesture ends a live paste attempt (the machine
    // cannot observe DOM selection). Cheap no-op when none is live.
    if (keyboard !== undefined && keyboard.snapshot.paste !== undefined) keyboard.invalidatePaste()
    snapCaretOutOfTokens(e.currentTarget)
  }

  // Button presses steal focus from the textarea; suppress at mousedown so
  // typing continues seamlessly. `preventScroll` for the same reason as the
  // unlock effect, and with no reveal of its own: the caret has not moved, and
  // the next keystroke gets the browser's native one.
  const keepFocus = (e: MouseEvent<HTMLButtonElement>): void => {
    e.preventDefault()
    inputRef.current?.focus({ preventScroll: true })
  }

  // Menu launchers keep the desktop typing flow but must NOT re-focus the
  // textarea on touch: a programmatic focus there raises the soft keyboard
  // over a menu the user is about to read. Mouse pointers get the same
  // suppression as {@link keepFocus}; pen/touch presses let the button take
  // focus naturally.
  const keepFocusForMouse = (e: React.PointerEvent<HTMLButtonElement>): void => {
    if (e.pointerType !== 'mouse') return
    e.preventDefault()
    inputRef.current?.focus({ preventScroll: true })
  }

  // Ordinary sessions retain their primary Send/Stop toggle, but a non-empty
  // draft outranks Stop while the session runs: typing into a running turn
  // means "queue this", so the primary flips back to Send — the same
  // queue-mode submit the running-state Enter gesture uses — until the draft
  // clears and Stop returns. A continuable child keeps Send as the primary
  // action regardless and exposes Stop independently.
  const draftQueues = running && subagent === null && !empty && queueEditItem === undefined
  const primaryStops = running && subagent === null && !draftQueues
  const interruptible = running && continuable
  // While a queued message is loaded into the composer, the primary button
  // saves that occurrence in place (Enter does the same).
  const primaryLabel = primaryStops ? t('input.stop') : queueEditItem !== undefined ? t('queue.save') : t('input.send')
  const onPrimary = (): void => {
    if (primaryStops) {
      stop?.()
      return
    }
    if (inputActions === undefined) return // absent machine: the button is disabled
    /* v8 ignore next -- defensive: the primary button is disabled while empty||disabled, so a click cannot reach the false arm. */
    if (!empty && !disabled && !machineBusy) inputActions.submit()
  }

  // The Access seat: the projection-fed permission chip (renders nothing
  // while the permissions key is absent — permission-less host or Draft —
  // or while the command face is absent with the session).
  const accessSelect: ReactNode = command === undefined
    ? null
    : <PermissionSelect key={sessionId} value={permissions} locked={locked} command={command} t={t} />

  const backdrop: ReactNode[] = []
  {
    // Segment boundaries: the token range end, every structured-reference
    // offset, and every text-ref range — merged in draft order (the sources never
    // overlap: structured references own their ranges, text-refs own plain tokens, the
    // claim token only leads).
    let cursor = 0
    const pushPlain = (upTo: number): void => {
      if (upTo > cursor) backdrop.push(draft.slice(cursor, upTo))
      cursor = upTo
    }
    if (deco.token !== null) {
      // The claimed command token renders as a token pill:
      const tokenText = draft.slice(deco.token.start, deco.token.end)
      const isHovered = hoveredKey === 'token'
      backdrop.push(
        <span
          key="token"
          className={clsx(css.tokenPill, isHovered && css.tokenPillHovered)}
          data-decoration="token"
          data-token-key="token"
          title={tokenText}
        >
          <span className={css.tokenIcon}>
            <ReferenceIcon kind="command" size={12} className={css.tokenIconGlyph} />
          </span>
          <span className={css.tokenLabel}>
            {formatTokenLabel(tokenText)}
          </span>
        </span>,
      )
      cursor = deco.token.end
    }
    type Boundary =
      | { at: number; kind: 'chip'; chip: (typeof deco.chips)[number] }
      | { at: number; kind: 'text-ref'; ref: (typeof deco.textRefs)[number] }
    const boundaries: Boundary[] = [
      ...deco.chips.map(chip => ({ at: chip.offset, kind: 'chip' as const, chip })),
      ...deco.textRefs.map(ref => ({ at: ref.start, kind: 'text-ref' as const, ref })),
    ].sort((a, b) => a.at - b.at)
    for (const b of boundaries) {
      if (b.at < cursor) continue // claim-token overlap: the leading mark wins
      pushPlain(b.at)
      if (b.kind === 'chip') {
        const chip = b.chip
        const chipKey = `chip-${chip.occurrenceId}`
        const isHovered = hoveredKey === chipKey
        backdrop.push(
          <span
            key={chipKey}
            className={clsx(
              css.tokenPill,
              chip.invalid && css.chipInvalid,
              isHovered && css.tokenPillHovered,
            )}
            data-decoration="chip"
            data-token-key={chipKey}
            data-reference-appearance={chip.appearance}
            data-occurrence={chip.occurrenceId}
            data-invalid={chip.invalid || undefined}
            title={chip.label}
          >
            <span className={css.tokenIcon}>
              {chip.appearance === 'file'
                ? <FileTypeIcon kind={fileTypeIconKind(chip.text)} size={12} className={css.tokenIconGlyph} />
                : chip.appearance !== undefined
                  ? <ReferenceIcon kind={chip.appearance} size={12} className={css.tokenIconGlyph} />
                  : <FileTypeIcon kind="file" size={12} className={css.tokenIconGlyph} />}
            </span>
            <span className={css.tokenLabel}>
              {formatTokenLabel(chip.text)}
            </span>
          </span>,
        )
        cursor = chip.offset + chip.length
      } else {
        const text = draft.slice(b.ref.start, b.ref.end)
        const refKey = `ref-${b.ref.start}`
        const isHovered = hoveredKey === refKey
        const appearance = b.ref.appearance ?? (b.ref.trigger === '@' ? 'file' : 'command')
        backdrop.push(
          <span
            key={refKey}
            className={clsx(
              css.tokenPill,
              isHovered && css.tokenPillHovered,
            )}
            data-decoration="text-ref"
            data-token-key={refKey}
            data-appearance={appearance}
            title={text}
          >
            <span className={css.tokenIcon}>
              {appearance === 'file'
                ? <FileTypeIcon kind={fileTypeIconKind(text)} size={12} className={css.tokenIconGlyph} />
                : <ReferenceIcon kind={appearance} size={12} className={css.tokenIconGlyph} />}
            </span>
            <span className={css.tokenLabel}>
              {formatTokenLabel(text)}
            </span>
          </span>,
        )
        cursor = b.ref.end
      }
    }
    pushPlain(draft.length)
    if (deco.hint !== null) {
      // Claim tokens have the `/name ` format (trailing space); trim to the bare name.
      const commandName = input?.claim?.token.slice(1).trim() ?? ''
      const hintKey = `hint.${commandName === 'goal' && hasGoal ? 'goal.active' : commandName}`
      // Dynamic lookup by claimed command name: unknown commands miss the
      // dictionary and keep the machine's own hint, so the call is wide.
      const translated = (t as Translate)(hintKey)
      const displayHint = translated !== hintKey ? translated : deco.hint
      backdrop.push(<span key="hint" className={css.hint} data-decoration="hint">{displayHint}</span>)
    }
  }

  return (
    <div className={clsx(css.root, variant === 'hero' && css.hero)}>
      {toast !== null && (
        <Toast
          key={toast.seq}
          text={toast.text}
          icon={<IconWarningOutline16 />}
          anchor={cardRef.current}
          onDone={dismissToast}
        />
      )}
      {notice?.level === 'info' && (
        <div className={css.notice} role="status">
          {notice.text}
        </div>
      )}
      {/* Trigger clicks land on the card, not the textarea: the toolbar row's
          disabled controls swallow clicks otherwise (the CSS state disarms
          their pointer events), so the WHOLE capsule is the pick target.
          pointerdown stops here so the Menu's outside-close cannot race the
          click's reopen (close-then-open flickers the chip's open echo). */}
      <div
        ref={cardRef}
        className={clsx(css.card, workspaceTrigger && css.cardWorkspaceTrigger)}
        data-composer-card
        onClick={workspaceTrigger ? onRequestWorkspace : undefined}
        onPointerDown={workspaceTrigger ? (e) => { e.stopPropagation() } : undefined}
      >
        {overlay !== undefined && <div className={css.overlayAnchor}>{overlay}</div>}
        {accessory !== undefined && <div className={css.accessory}>{accessory}</div>}
        {queueEditItem !== undefined && (
          <div className={css.queueEdit} data-queue-editing="">
            <span className={css.queueEditLead} aria-hidden><IconQueueOutline14 /></span>
            <span className={css.queueEditText} role="status">{t('queue.editing')}</span>
            <Tooltip label={t('queue.cancelEdit')} side="top" delayMs={500}>
              <button
                type="button"
                className={css.queueEditCancel}
                aria-label={t('queue.cancelEdit')}
                onMouseDown={keepFocus}
                onClick={() => { keyboard?.cancelQueueEdit() }}
              >
                <IconCloseOutline16 size={14} />
              </button>
            </Tooltip>
          </div>
        )}
        {renderSlot('conversation.input.attachments', {
          attachments,
          canAcceptDrop,
          warning: promptError?.error.code === 'attachment-error' && promptError.error.details?.reason === 'MODEL_DOES_NOT_SUPPORT_IMAGES'
            ? t('image.modelUnsupported')
            : undefined,
          onAddFiles: intakeFiles,
          onRemoveAttachment: (id) => { removeAttachment?.(id) },
          onRestoreText: restoreTextAttachment,
          dropLimits: imageLimits === undefined ? undefined : {
            count: imageLimits.maxImagesPerMessage,
            size: imageSizeText(imageLimits.maxImageBytes),
          },
          imagePixelLimits: imageLimits === undefined ? undefined : {
            maxPixels: imageLimits.maxImagePixels,
            maxDimension: imageLimits.maxImageDimension,
          },
        })}
        {/* One scrollport, two text layers. The hidden mirror renders draft+'\n' and stretches the
            stack to the draft's FULL height (counting rows by '\n' cannot see soft wraps); the
            absolutely-positioned backdrop and textarea ride that height, and .scroll — capped at 14
            lines in CSS — is the only thing that scrolls. The caret belongs to the textarea and the
            glyphs to the backdrop, so they can only stay together by moving together: one scroll
            offset the browser applies to both layers at once, never a JS mirror between two boxes,
            which a compositor-driven gesture outruns and leaves the words trailing the caret. */}
        <div ref={scrollRef} className={css.scroll} data-input-scroll>
          <div className={css.grow}>
            <div
              ref={backdropRef}
              aria-hidden
              className={clsx(css.backdrop, textareaDisabled && css.backdropDisabled)}
              data-input-backdrop
              data-disabled={textareaDisabled || undefined}
            >
              {backdrop}
            </div>
            <textarea
              ref={inputRef}
              className={css.input}
              value={draft}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              disabled={textareaDisabled}
              readOnly={machineBusy || workspaceTrigger}
              aria-label={workspaceTrigger ? t('hero.chooseWorkspace') : undefined}
              aria-haspopup={workspaceTrigger ? 'menu' : undefined}
              aria-expanded={workspaceTrigger ? workspacePickerOpen : undefined}
              data-phase={input?.phase ?? 'inert'}
              placeholder={placeholder ?? (parentOffline
                ? t('placeholder.parentOffline')
                : disabled
                  ? t('placeholder.unavailable')
                  // The steer hint deliberately outranks the plan placeholder:
                  // while it shows, the whole-queue gesture is genuinely available
                  // (the gate never consults plan mode), so the actionable hint wins.
                  : canSteerQueue
                    ? t('placeholder.steerQueue')
                    : planActive ? t('placeholder.plan') : t('placeholder.default'))}
              rows={2}
              onChange={onChange}
              onKeyDown={onKeyDown}
              onSelect={onSelect}
              onMouseMove={onMouseMove}
              onMouseLeave={onMouseLeave}
              onClick={(e) => { snapCaretOutOfTokens(e.currentTarget) }}
              onKeyUp={(e) => { snapCaretOutOfTokens(e.currentTarget) }}
              onCopy={(e) => { onCopyOrCut(e, false) }}
              onCut={(e) => { onCopyOrCut(e, true) }}
              onPaste={onPaste}
              onCompositionStart={onCompositionStart}
              onCompositionEnd={onCompositionEnd}
            />
            <div ref={mirrorRef} aria-hidden className={css.mirror} data-input-mirror>{`${draft}\n`}</div>
          </div>
        </div>
        <div className={css.row}>
          <div className={css.tools}>
            {/* The attachment menu: upload today, more entries later. Slash
              commands stay on the '/' trigger inside the textarea. */}
            <Menu
              open={addMenuOpen}
              side="top"
              anchor={
                <Tooltip label={t('input.add')} side="top" delayMs={500}>
                  <button
                    type="button"
                    className={css.add}
                    aria-label={t('input.add')}
                    aria-haspopup="menu"
                    aria-expanded={addMenuOpen}
                    disabled={locked}
                    onPointerDown={keepFocusForMouse}
                    onClick={() => { setAddMenuOpen(open => !open) }}
                  >
                    <IconPlusOutline16 size={14} />
                  </button>
                </Tooltip>
              }
              items={[
                { id: 'upload-file', label: t('input.uploadFile'), icon: <IconPaperclipOutline16 size={14} /> },
              ]}
              onSelect={(id) => {
                setAddMenuOpen(false)
                if (id === 'upload-file') fileInputRef.current?.click()
              }}
              onClose={() => { setAddMenuOpen(false) }}
            />
            <div className={css.modes}>
              {accessSelect}
              {renderSlot('conversation.input.plan', { locked })}
            </div>
            {leftItems}
          </div>
          <div className={css.trailing}>
            {rightItems}
            {renderSlot('conversation.input.model', { locked: modelSeatLocked })}
            <ContextMeter useProjection={useProjection} t={t} />
            {interruptible && (
              <Tooltip label={t('input.stop')} side="top" delayMs={500}>
                <button
                  type="button"
                  className={css.primary}
                  aria-label={t('input.stop')}
                  disabled={stop === undefined}
                  onMouseDown={keepFocus}
                  onClick={stop}
                >
                  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
                    <rect x="3" y="3" width="10" height="10" rx="3" fill="currentColor" />
                  </svg>
                </button>
              </Tooltip>
            )}
            <Tooltip label={primaryLabel} side="top" delayMs={500}>
              <button
                type="button"
                className={css.primary}
                aria-label={primaryLabel}
                disabled={primaryStops ? stop === undefined : empty || disabled || machineBusy}
                onMouseDown={keepFocus}
                onClick={onPrimary}
              >
                {primaryStops ? (
                  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
                    <rect x="3" y="3" width="10" height="10" rx="3" fill="currentColor" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
                    <path d="M8.3125 0.980183C8.66767 1.0531 8.97902 1.20418 9.2627 1.43233C9.48724 1.61297 9.73029 1.85793 9.97949 2.10714L14.707 6.83468L13.293 8.24874L9 3.95577V15.0417H7V3.95577L2.70703 8.24874L1.29297 6.83468L6.02051 2.10714C6.26971 1.85793 6.51277 1.61297 6.7373 1.43233C6.97662 1.23986 7.28445 1.04402 7.6875 0.980183C7.8973 0.947006 8.1031 0.95516 8.3125 0.980183Z" fill="currentColor" />
                  </svg>
                )}
              </button>
            </Tooltip>
          </div>
        </div>
      </div>
      {/* Hidden multi-file picker behind the attachment menu's upload entry;
        the value reset lets the same file be picked twice in a row. */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className={css.fileInput}
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          intakeFiles(Array.from(e.target.files ?? []))
          e.target.value = ''
        }}
      />
      {footer}
    </div>
  )
}
