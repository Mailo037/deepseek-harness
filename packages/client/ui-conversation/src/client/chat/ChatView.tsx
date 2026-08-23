// ChatView: the default conversation view — one stable keyed parent list over
// final business Nodes, plus paging, pending steering and bottom-follow.
// Each row dispatches through 'conversation.chat.node'; ui-tool owns the
// tool-call renderer and its recursive root/subcall composition. A Host
// open-path refusal from the injected opener is an in-page dialog here.
//
// Scroll: when nested under `[data-conversation-scroll]` (active conversation
// column), that host is the scrollport and this view is flow content; when
// mounted alone (unit tests), `.scroll` owns overflow. Bottom-follow and
// prepend anchoring always target the resolved scrollport.
//
// Render economics: order changes only when rows enter, leave or move. Each
// ChatNodeSeat subscribes to one Node key, so Assistant deltas and Tool
// lifecycle updates replace only their own row without remounting it.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  ChatConversationViewNode, ConversationTimelineSnapshot, ToolCallBlock,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  Button, IconChecklistOutline14, IconChevronDownOutline14, IconCodeOutline16, IconEditOutline16,
  IconGlobeOutline14, IconGoalOutline16, IconSearchOutline16, IconThinkOutline14, Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps, RenderMessageImages } from '../contract/slots.ts'
import { PendingSteeringBubble } from './MessageItem.tsx'
import { ChatNodeSeat } from './ChatNodeSeat.tsx'
import { ToolCallGroup } from './ToolCallGroup.tsx'
import { TurnWorkSummary } from './TurnWorkSummary.tsx'
import { formatRunDuration } from './message-chrome.ts'
import a11yCss from './accessibility.module.css'
import css from './ChatView.module.css'

const FOLLOW_THRESHOLD = 24

/**
 * Scroll-top zone (px) that requests the next older history page. Kept under
 * the anchor-test setup offsets (50/80) so a reader scrolling to a positioned
 * anchor does not itself page; only reaching the top zone does.
 */
const OLDER_TRIGGER_TOP = 8

/** Active column host when present; otherwise the view-local scroller. */
function scrollerOf(from: HTMLElement): HTMLElement {
  return (from.closest('[data-conversation-scroll]')) ?? from
}

interface PagingAnchor {
  /** Stable node/call identity, independent of boundary-spanning group keys. */
  key: string
  /** Row top relative to the scrollport after the latest user scroll. */
  top: number
}

/** Find an already-rendered settled row without interpolating a selector. */
function anchorElement(list: HTMLElement, key: string): HTMLElement | null {
  for (const row of list.querySelectorAll<HTMLElement>('[data-chat-anchor-key]')) {
    if (row.dataset.chatAnchorKey === key) return row
  }
  return null
}

/** Row position in scrollport coordinates (viewport-independent). */
function flowTop(row: HTMLElement, scrollport: HTMLElement): number {
  return row.getBoundingClientRect().top - scrollport.getBoundingClientRect().top
}

/** Select a visible stable node/call identity, falling back only when layout
 * has not exposed a visible box yet. */
function pagingAnchor(list: HTMLElement, scrollport: HTMLElement): HTMLElement | null {
  const viewport = scrollport.getBoundingClientRect()
  const composer = scrollport.querySelector<HTMLElement>('[data-composer-seat]')
  const visibleBottom = composer?.getBoundingClientRect().top ?? viewport.bottom
  // Scroll events are hot: hit-test a few points through the stretched flow
  // rows before considering the full mounted set. The fallback keeps jsdom
  // and pre-layout states deterministic; a virtualizer naturally bounds it.
  if (typeof document.elementsFromPoint === 'function' && visibleBottom > viewport.top) {
    const content = list.getBoundingClientRect()
    const left = Math.max(viewport.left, content.left)
    const right = Math.min(viewport.right, content.right)
    const x = left + Math.max(0, right - left) / 2
    const height = visibleBottom - viewport.top
    const points = [1, Math.min(32, height / 3), height / 2, Math.max(1, height - 1)]
    for (const offset of points) {
      for (const element of document.elementsFromPoint(x, viewport.top + offset)) {
        const row = element instanceof HTMLElement
          ? element.closest<HTMLElement>('[data-chat-anchor-key]')
          : null
        if (row !== null && list.contains(row)) return row
      }
    }
  }
  const rows = [...list.querySelectorAll<HTMLElement>('[data-chat-anchor-key]')]
  const visibleRows = rows.filter((row) => {
    const rect = row.getBoundingClientRect()
    return rect.bottom > viewport.top && rect.top < visibleBottom
  })
  return visibleRows[0] ?? rows[0] ?? null
}

type ChatScrollPosition = NonNullable<ReturnType<ChatViewSlotProps['chatScroll']['read']>>

/** Capture a reflow-resistant reader position from the current rendered window. */
function scrollPosition(list: HTMLElement, scrollport: HTMLElement): ChatScrollPosition | null {
  const row = pagingAnchor(list, scrollport)
  const anchorKey = row?.dataset.chatAnchorKey
  if (row === null || anchorKey === undefined) return null
  return {
    anchorKey,
    anchorTop: flowTop(row, scrollport),
    scrollTop: scrollport.scrollTop,
  }
}

/** Host/OS refusal text for the file-open dialog; empty throws keep a locale fallback. */
function openFailureMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error)
  return message === '' ? fallback : message
}

/** ProducedFiles opens the session workspace as `.`. */
function isFolderOpenPath(path: string): boolean {
  return path === '.'
}

function runningTurnStartTime(timeline: ConversationTimelineSnapshot): number | null {
  let latest: number | null = null
  for (const turn of timeline.turns.values()) {
    if (turn.status === 'open' && turn.start !== undefined) latest = turn.start.time
  }
  return latest
}

/**
 * Extract a closed turn number from a Node's resolved Location, or undefined
 * when the turn is still open or the Node has no turn affinity.
 * @param node - Chat Node with its resolved Location.
 * @returns the turn number for a closed turn, or undefined when open/session.
 */
function closedTurnOf(node: ChatConversationViewNode): number | undefined {
  const location = node.location
  if (location.kind !== 'turn' && location.kind !== 'step') return undefined
  return location.turn.status === 'closed' ? location.turn.turn : undefined
}

/** Narrowed view of the Assistant chat payload fields the fold decision reads. */
interface AssistantMeta {
  readonly finalNode?: { readonly seq: number }
  readonly blocks?: readonly { readonly kind: string; readonly text?: string }[]
  readonly status?: 'running' | 'settled' | 'interrupted'
}

/**
 * Whether an assistant Step renders only Think chrome plus tool heads — no
 * visible text (or image/other content). Such nodes belong inside the tool
 * window, since their only rendered content is the Think row. Whitespace-only
 * text blocks don't count as visible text; a node with just tool heads (no
 * reasoning/text) renders an empty shell and stays out. An interrupted step
 * carries its own Stopped marker and always renders in flow, splitting the
 * surrounding tool run instead of tucking into it.
 * @param node - settled/interrupted Assistant chat node.
 * @returns true when reasoning is present, the step is not interrupted, and
 *   nothing visible except it remains.
 */
function isThinkOnly(node: ChatConversationViewNode): boolean {
  if (node.kind !== 'assistant-step') return false
  const { blocks, status } = node.data as AssistantMeta
  if (status === 'interrupted') return false
  if (blocks === undefined || !blocks.some(block => block.kind === 'reasoning')) return false
  return blocks.every(block =>
    block.kind === 'reasoning'
    || block.kind === 'tool-call'
    || (block.kind === 'text' && (block.text ?? '').trim() === ''))
}


/** Wire tool names whose calls mutate files. */
const EDIT_TOOL_NAMES = new Set(['write', 'edit', 'multiedit', 'notebookedit', 'apply_patch', 'str_replace'])

/**
 * Read a settled or running root call's wire tool name.
 * @param node - tool-call Chat Node.
 * @returns the tool name, or undefined when the call head was windowed out.
 */
function toolNameOf(node: ChatConversationViewNode): string | undefined {
  if (node.kind !== 'tool-call') return undefined
  const root: ToolCallBlock = (node.data as { readonly root: ToolCallBlock }).root
  return 'kind' in root ? root.call?.name ?? undefined : root.name
}

/**
 * Humanize a wire tool name for the group header ("get_goal" → "Get Goal").
 * @param name - wire tool name.
 * @returns the display name.
 */
function humanizeToolName(name: string): string {
  return name.split(/[_\-\s]+/u).filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

/**
 * Pick the header icon for one tool family. Coarse wire-name families only —
 * the per-row icons stay owned by the tool views.
 * @param name - wire tool name.
 * @returns the header icon element.
 */
function toolIconOf(name: string): ReactNode {
  const n = name.toLowerCase()
  if (EDIT_TOOL_NAMES.has(n)) return <IconEditOutline16 />
  if (/^(bash|shell|exec|run_code|terminal)/u.test(n)) return <IconCodeOutline16 />
  if (/(search|grep|glob|find)/u.test(n)) return <IconSearchOutline16 />
  if (/^(web|fetch)/u.test(n)) return <IconGlobeOutline14 />
  if (/todo/u.test(n)) return <IconChecklistOutline14 />
  if (/goal/u.test(n)) return <IconGoalOutline16 />
  return <IconChecklistOutline14 />
}

/** Header material for one tool/think run. */
interface GroupHeader {
  readonly icon: ReactNode
  readonly label: string
}

/**
 * Derive the run header from its member nodes: the LAST action names the run,
 * unless the run edited several files — then the header summarizes the file
 * work. A run of Think rows alone names itself "Think".
 * @param nodes - the run's member nodes, in display order.
 * @param t - the owning view's locale seat.
 * @returns icon and label for the run header.
 */
function groupHeaderOf(
  nodes: readonly ChatConversationViewNode[],
  t: ChatViewSlotProps['t'],
): GroupHeader {
  const toolNodes = nodes.filter(node => node.kind === 'tool-call')
  const edited = toolNodes.filter((node) => {
    const name = toolNameOf(node)
    return name !== undefined && EDIT_TOOL_NAMES.has(name.toLowerCase())
  })
  if (edited.length >= 2) return { icon: <IconEditOutline16 />, label: t('toolGroup.editedFiles') }
  const last = toolNodes.at(-1)
  const lastName = last === undefined ? undefined : toolNameOf(last)
  if (lastName === undefined) return { icon: <IconThinkOutline14 size={14} />, label: 'Think' }
  return { icon: toolIconOf(lastName), label: humanizeToolName(lastName) }
}

/**
 * Whether a tool block — or any of its nested subcalls — is still running.
 * @param block - root or child call lifecycle value.
 * @returns true when the block lacks its final result.
 */
function blockActive(block: ToolCallBlock): boolean {
  return 'kind' in block ? block.subCalls.some(blockActive) : true
}

/**
 * Whether any call inside a run is still running (drives the window's
 * open-while-active / tuck-when-settled behavior).
 * @param nodes - the run's member nodes, in display order.
 * @returns true when at least one member call lacks its result.
 */
function runIsActive(nodes: readonly ChatConversationViewNode[]): boolean {
  return nodes.some((node) => {
    if (node.kind !== 'tool-call') return false
    return blockActive((node.data as { readonly root: ToolCallBlock }).root)
  })
}

/** Whale-and-sea quip locale keys shown while a turn runs. The first key is
 *  the default label; later ones take over every `DIVE_PHRASE_STEP_MS`, so a
 *  long-running turn gets a rotating gag instead of a frozen status. Purely
 *  cosmetic: the index is a pure function of elapsed time, keeping replay and
 *  snapshots deterministic. */
const DIVE_PHRASE_KEYS = [
  'status.dive.0',
  'status.dive.1',
  'status.dive.2',
  'status.dive.3',
  'status.dive.4',
  'status.dive.5',
  'status.dive.6',
  'status.dive.7',
  'status.dive.8',
  'status.dive.9',
] as const

/** How long each quip stays on screen before the next one surfaces. */
const DIVE_PHRASE_STEP_MS = 15_000

/** Turn-level model activity label retained across first-token, tool, and streaming phases. */
function TurnStatus({ startTime, t }: {
  /** The running turn's logged `turn/start` time; null falls back to mount
   *  time when that boundary is outside the window. */
  startTime: number | null
  /** The owning view's locale seat. */
  t: ChatViewSlotProps['t']
}) {
  const [mountedAt] = useState(() => Date.now())
  // Anchored to the earliest start time of this active run (or mount time)
  // so intermediate tool calls/steps during a run do not reset the clock or rotating phrase.
  const [anchor, setAnchor] = useState(() => startTime ?? mountedAt)
  useEffect(() => {
    if (startTime !== null) {
      setAnchor(prev => Math.min(prev, startTime))
    }
  }, [startTime])
  const [elapsedMs, setElapsedMs] = useState(() => Math.max(0, Date.now() - anchor))
  useEffect(() => {
    const tick = (): void => {
      setElapsedMs(Math.max(0, Date.now() - anchor))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => { clearInterval(id) }
  }, [anchor])
  // Short turns keep the plain label; the clock only appears once the turn
  // has clearly been running for a while.
  const showClock = elapsedMs >= 15_000
  // Deterministic gag: index advances one step per DIVE_PHRASE_STEP_MS, so the
  // label cycles without randomising replay or snapshots.
  const phrase = t(DIVE_PHRASE_KEYS[Math.floor(elapsedMs / DIVE_PHRASE_STEP_MS) % DIVE_PHRASE_KEYS.length]
    ?? 'status.dive.0')
  return (
    <div className={css.turnStatus} role="status" aria-live="polite">
      {phrase}
      {showClock && (
        <span className={css.turnStatusClock} aria-hidden>
          {formatRunDuration(elapsedMs, t)}
        </span>
      )}
    </div>
  )
}

/**
 * The chat view slot entry: pure component over the composed props; each
 * ordered business Node crosses the keyed renderer seat.
 */
export function ChatView({
  useSession, useSessions, useStore, renderSlot, sessionId, openFile, loadOlder, loadImage, inspectCall, chatScroll, forkAt,
  sendMessage, fileMentions, t,
}: ChatViewSlotProps) {
  const order = useSession(s => s.chat.order)
  const nodeStore = useSession(s => s.chat.nodes)
  const timeline = useSession(s => s.chat.timeline)
  const inbox = useSession(s => s.queue)
  // Workspace root off the session list row: path summaries display relative to it.
  const cwd = useSessions(s => s.byId[sessionId]?.cwd)
  const running = useSession(s => s.running)
  const openState = useSession(s => s.openState)
  const openError = useSession(s => s.openError)
  const hasMore = useSession(s => s.hasMore)
  const loadingOlder = useSession(s => s.loadingOlder)
  const selectedCallId = useStore(s => s.selection?.callId)
  const [fileOpenError, setFileOpenError] = useState<{ path: string; message: string } | null>(null)
  const [fileOpenBusy, setFileOpenBusy] = useState(false)
  // Close/retry must ignore a settlement that started before the latest
  // gesture; otherwise a cancelled in-flight refusal reopens the dialog.
  const fileOpenRequest = useRef(0)

  const requestOpenFile = useCallback((path: string) => {
    const id = ++fileOpenRequest.current
    setFileOpenBusy(true)
    void openFile(path).then(
      () => {
        if (id !== fileOpenRequest.current) return
        setFileOpenError(null)
        setFileOpenBusy(false)
      },
      (error: unknown) => {
        if (id !== fileOpenRequest.current) return
        setFileOpenError({
          path,
          message: openFailureMessage(
            error,
            t(isFolderOpenPath(path) ? 'fileOpen.folderUnknown' : 'fileOpen.unknown'),
          ),
        })
        setFileOpenBusy(false)
      },
    )
  }, [openFile, t])

  const closeFileOpenError = useCallback(() => {
    fileOpenRequest.current += 1
    setFileOpenError(null)
    setFileOpenBusy(false)
  }, [])

  const pendingSteering = useMemo(
    () => inbox.filter(item => item.placement === 'steering'),
    [inbox],
  )
  const renderMessageImages = useCallback<RenderMessageImages>(
    owner => renderSlot('conversation.message.images', { ...owner, loadImage }),
    [loadImage, renderSlot],
  )
  const runningTurnStart = useMemo(() => runningTurnStartTime(timeline), [timeline])

  const listRef = useRef<HTMLDivElement | null>(null)
  const columnRef = useRef<HTMLDivElement | null>(null)
  const atBottomRef = useRef(true)
  const [atBottom, setAtBottom] = useState(true)
  /** Last position delivered or written on the main thread. */
  const observedTopRef = useRef(0)
  /** Paging anchor: semantic row/position at click, updated by reader scrolls
   * while the request is pending and restored after the prepend lands. */
  const anchorRef = useRef<PagingAnchor | null>(null)
  const firstSeqRef = useRef<number | null>(null)
  const openedRef = useRef(false)
  const lastKeyRef = useRef<string | null>(null)
  const lastSteeringIdRef = useRef<string | null>(null)
  /** Flow tip signature — follow-scroll only when this moves, never on a
   *  scroll-driven at-bottom chrome re-render (which would snap inertial
   *  scrolls the rest of the way to the floor). */
  const followSigRef = useRef<string | null>(null)

  const firstKey = order[0]
  const firstSeq = firstKey === undefined ? null : nodeStore.get(firstKey)?.anchorSeq ?? null
  const lastKey = order.at(-1) ?? null
  const lastNode = lastKey === null ? undefined : nodeStore.get(lastKey)
  const lastSteeringId = pendingSteering[pendingSteering.length - 1]?.id ?? null
  const followSig = `${openState}:${firstSeq}:${lastKey}:${order.length}:${running ? 1 : 0}:${lastSteeringId ?? ''}`

  const toBottom = (el: HTMLElement): void => {
    anchorRef.current = null
    el.scrollTop = el.scrollHeight
    observedTopRef.current = el.scrollTop
    atBottomRef.current = true
    setAtBottom(true)
    chatScroll.save(null)
  }

  useLayoutEffect(() => {
    const local = listRef.current
    /* v8 ignore next -- ref-null guard: React attaches the ref before layout effects run. */
    if (local === null) return
    const el = scrollerOf(local)
    // Open completed: jump to the bottom once — unless a scroll position
    // survives from a previous mount (view-tab switch away and back), which
    // is restored instead of snapping the reader back to the floor.
    if (openState === 'open' && !openedRef.current) {
      openedRef.current = true
      const saved = chatScroll.read()
      if (saved === null) {
        toBottom(el)
      } else {
        el.scrollTop = saved.scrollTop
        const row = anchorElement(local, saved.anchorKey)
        if (row !== null) el.scrollTop += flowTop(row, el) - saved.anchorTop
        observedTopRef.current = el.scrollTop
        const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_THRESHOLD + 1
        atBottomRef.current = isAtBottom
        setAtBottom(isAtBottom)
        const normalized = isAtBottom ? null : scrollPosition(local, el)
        if (isAtBottom) chatScroll.save(null)
        else if (normalized !== null) chatScroll.save(normalized)
      }
      firstSeqRef.current = firstSeq
      lastKeyRef.current = lastKey
      lastSteeringIdRef.current = lastSteeringId
      followSigRef.current = followSig
      return
    }
    // Prepend (head seq decreased): preserve the same settled row at the
    // position established by the reader's latest scroll. This excludes
    // unrelated tail/composer growth while the request was in flight.
    if (anchorRef.current !== null && firstSeq !== null && firstSeqRef.current !== null && firstSeq < firstSeqRef.current) {
      const anchor = anchorRef.current
      anchorRef.current = null
      const row = anchorElement(local, anchor.key)
      if (row !== null) el.scrollTop += flowTop(row, el) - anchor.top
      observedTopRef.current = el.scrollTop
      firstSeqRef.current = firstSeq
      /* v8 ignore next -- ?? arm: a prepend adds nodes, so the flow list here is never empty. */
      lastKeyRef.current = lastKey
      lastSteeringIdRef.current = lastSteeringId
      followSigRef.current = followSig
      return
    }
    firstSeqRef.current = firstSeq
    // Own words must be visible: a new trailing user node force-scrolls
    // (send lives in the composer, so arrival is detected here, not armed there).
    const appendedUser = lastKey !== lastKeyRef.current && lastNode?.kind === 'user'
    const appendedSteering = lastSteeringId !== null && lastSteeringId !== lastSteeringIdRef.current
    const tipMoved = followSigRef.current !== followSig
    lastKeyRef.current = lastKey
    lastSteeringIdRef.current = lastSteeringId
    followSigRef.current = followSig
    // Follow new flow content while pinned; do NOT re-pin on every render
    // merely because atBottomRef is true (scroll threshold → setState → snap).
    if (appendedUser || appendedSteering || (tipMoved && atBottomRef.current)) toBottom(el)
  })

  const onScrollRef = useRef(() => {})
  onScrollRef.current = () => {
    const local = listRef.current
    /* v8 ignore next -- ref-null guard: the handler only fires while mounted. */
    if (local === null) return
    const el = scrollerOf(local)
    // Only reader input may make raw scroll geometry change follow ownership:
    // a delivered position that deviates from the observed-top ledger (every
    // programmatic write records itself there synchronously). This covers
    // wheel, touch, scrollbar, and keyboard alike without naming devices.
    // Browser shrink-clamps land exactly on the floor min and delayed
    // programmatic deliveries land on the ledger itself, so both preserve
    // the current ownership state.
    const floor = Math.max(0, el.scrollHeight - el.clientHeight)
    const movedByReader = Math.abs(el.scrollTop - Math.min(observedTopRef.current, floor)) > 0.5
    const isAtBottom = movedByReader
      ? floor - el.scrollTop <= FOLLOW_THRESHOLD + 1
      : atBottomRef.current
    if (!movedByReader && isAtBottom) {
      toBottom(el)
      return
    }
    atBottomRef.current = isAtBottom
    setAtBottom(isAtBottom)
    const position = isAtBottom ? null : scrollPosition(local, el)
    if (isAtBottom) {
      anchorRef.current = null
    } else if (anchorRef.current !== null && position !== null) {
      anchorRef.current = { key: position.anchorKey, top: position.anchorTop }
    }
    // Continuous save (unmount happens after ref detach, so saving there is
    // too late); pinned-to-bottom clears so a remount keeps following.
    if (isAtBottom) chatScroll.save(null)
    else if (position !== null) chatScroll.save(position)
    // Scroll-up paging: a reader scroll that reaches the loaded head with more
    // older history pulls the next page (anchored, so the prepend keeps the
    // reading position). The movedByReader check keeps programmatic prepend
    // adjustments from re-triggering.
    if (movedByReader && hasMore && !loadingOlder && openState === 'open' && el.scrollTop <= OLDER_TRIGGER_TOP) {
      loadOlderAnchored()
    }
    observedTopRef.current = el.scrollTop
  }

  // Bind the scroll listener on the resolved scrollport once per mount;
  // reader-input attribution rides the observed-top ledger, not per-device
  // input listeners.
  useEffect(() => {
    const local = listRef.current
    /* v8 ignore next -- ref-null guard: effect runs after the list node commits. */
    if (local === null) return
    const el = scrollerOf(local)
    const onScroll = (): void => { onScrollRef.current() }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
    }
  }, [])

  // The ref starts null and is assigned every render, so the placeholder
  // initializer a function initial value would need never exists.
  const followRef = useRef<(() => void) | null>(null)
  followRef.current = () => {
    const local = listRef.current
    if (local !== null && atBottomRef.current) {
      const el = scrollerOf(local)
      el.scrollTop = el.scrollHeight
      observedTopRef.current = el.scrollTop
      chatScroll.save(null)
    }
  }
  // Streaming, tool disclosures, and other flow changes resize the column;
  // the sticky composer resizes outside it. This observer owns ChatView's
  // dynamic-height follow decisions and writes only while the reader is pinned.
  useEffect(() => {
    const column = columnRef.current
    const local = listRef.current
    if (column === null || local === null || typeof ResizeObserver === 'undefined') return
    const scrollport = scrollerOf(local)
    const composer = scrollport.querySelector<HTMLElement>('[data-composer-seat]')
    const observer = new ResizeObserver(() => { followRef.current?.() })
    observer.observe(column)
    if (composer !== null) observer.observe(composer)
    return () => { observer.disconnect() }
  }, [])

  // A failed/empty page leaves the head unchanged. Once the request leaves
  // its busy state there is no future prepend for the saved anchor to own.
  useEffect(() => {
    if (!loadingOlder) anchorRef.current = null
  }, [loadingOlder])

  // Auto-fill: a window shorter than the scrollport cannot be scrolled up, so
  // older history would be unreachable — load pages until the flow fills the
  // scrollport or history ends. Pinned readers stay pinned (prepends grow
  // above by the follow logic). The clientHeight guard keeps jsdom tests off
  // this path (no layout exports), leaving scroll-driven paging to drive them.
  useLayoutEffect(() => {
    if (openState !== 'open' || !hasMore || loadingOlder) return
    const local = listRef.current
    if (local === null) return
    const el = scrollerOf(local)
    if (el.clientHeight <= 0) return
    if (el.scrollHeight - el.clientHeight > 0) return
    loadOlder()
  })

  const loadOlderAnchored = (): void => {
    const local = listRef.current
    /* v8 ignore next -- ref-null guard: the paging button renders inside the list tree. */
    if (local !== null) {
      const el = scrollerOf(local)
      const row = pagingAnchor(local, el)
      if (row !== null && row.dataset.chatAnchorKey !== undefined) {
        anchorRef.current = {
          key: row.dataset.chatAnchorKey,
          top: flowTop(row, el),
        }
      }
    }
    loadOlder()
  }

  const seat = (nodeKey: string, hideAssistantReasoning?: boolean): ReactNode => (
    <ChatNodeSeat
      key={nodeKey}
      nodeKey={nodeKey}
      useSession={useSession}
      selectedCallId={selectedCallId}
      cwd={cwd}
      openFile={requestOpenFile}
      inspectCall={inspectCall}
      forkAt={forkAt}
      sendMessage={sendMessage}
      renderMessageImages={renderMessageImages}
      fileMentions={fileMentions}
      {...(hideAssistantReasoning === undefined ? {} : { hideAssistantReasoning })}
      renderSlot={renderSlot}
      t={t}
    />
  )

  // Flow construction. Contiguous tool runs live inside one bounded scroll
  // window whose header names the run's last action; a run of one call renders
  // as the bare row (no window chrome). Think-only steps join the surrounding
  // run while tool calls keep following them; a TRAILING think-only step (no
  // further tool call precedes the next visible content) renders in flow — its
  // reasoning belongs to the answer text it leads, not to the tool window
  // above; steps with visible text render in flow and split the run.
  interface FlowElement { readonly el: ReactNode; readonly fold: boolean }
  const foldableNode = (node: ChatConversationViewNode, closingSeq: number | null): boolean => {
    if (node.kind === 'tool-call' || node.kind === 'model-retry' || node.kind === 'context' || isThinkOnly(node)) return true
    if (closingSeq === null || node.kind !== 'assistant-step') return false
    const data = node.data as AssistantMeta
    // An interrupted step stays in flow: its Stopped marker must never hide
    // behind a work-summary fold.
    if (data.status === 'interrupted') return false
    return data.blocks?.some(block => block.kind === 'text') === true
      && data.finalNode !== undefined && data.finalNode.seq !== closingSeq
  }
  const buildElements = (keys: readonly string[], closingSeq: number | null): FlowElement[] => {
    const out: FlowElement[] = []
    let run: {
      firstKey: string
      toolKey: string
      children: ReactNode[]
      nodes: ChatConversationViewNode[]
    } | null = null
    // Think-only steps met since the run's last tool call. They join the run
    // when another tool call follows; otherwise they flush as standalone rows.
    let trailingThink: { key: string; node: ChatConversationViewNode }[] = []
    const flushThinkIntoRun = (): void => {
      if (run === null) {
        const first = trailingThink[0]
        if (first === undefined) return
        run = { firstKey: first.key, toolKey: first.key, children: [], nodes: [] }
      }
      for (const pending of trailingThink) {
        run.children.push(seat(pending.key))
        run.nodes.push(pending.node)
      }
      trailingThink = []
    }
    const flushTrailingThinkStandalone = (): void => {
      if (run !== null) flushRun()
      for (const pending of trailingThink) {
        out.push({ el: seat(pending.key), fold: foldableNode(pending.node, closingSeq) })
      }
      trailingThink = []
    }
    const flushRun = (): void => {
      if (run === null) return
      if (run.children.length === 1) {
        // A single call needs no window chrome around it — the bare row IS
        // the one-line summary.
        out.push({ el: run.children[0] as ReactNode, fold: true })
      } else {
        const header = groupHeaderOf(run.nodes, t)
        out.push({
          el: (
            <ToolCallGroup
              key={`tool-group:${run.toolKey}`}
              icon={header.icon}
              label={header.label}
              active={runIsActive(run.nodes)}
            >
              {run.children}
            </ToolCallGroup>
          ),
          fold: true,
        })
      }
      run = null
    }
    for (const key of keys) {
      const node = nodeStore.get(key)
      if (node === undefined) {
        flushTrailingThinkStandalone()
        out.push({ el: seat(key), fold: false })
        continue
      }
      if (node.kind === 'tool-call' || node.kind === 'model-retry') {
        flushThinkIntoRun()
        if (run === null) {
          run = { firstKey: key, toolKey: key, children: [], nodes: [] }
        }
        run.children.push(seat(key))
        run.nodes.push(node)
        continue
      }
      if (isThinkOnly(node)) {
        trailingThink.push({ key, node })
        continue
      }
      flushTrailingThinkStandalone()
      out.push({ el: seat(key), fold: foldableNode(node, closingSeq) })
    }
    flushTrailingThinkStandalone()
    return out
  }

  // Segment the order by consecutive equal closed turns first: a
  // session-scoped row between two segments of one turn (an admitted steer,
  // for example) splits the turn's nodes without ending it. Fold decisions
  // therefore read the WHOLE turn — per-segment counting rendered two
  // identical "ran for" folds for one split turn.
  interface BuiltSegment {
    readonly closedTurn: number | undefined
    readonly actionCount: number
    readonly elements: FlowElement[]
  }
  const built: BuiltSegment[] = []
  for (let index = 0; index < order.length;) {
    const nodeKey = order[index] as string
    const node = nodeStore.get(nodeKey)
    const closedTurn = node === undefined ? undefined : closedTurnOf(node)
    const chunk: string[] = [nodeKey]
    let next = index + 1
    while (next < order.length) {
      const candidate = nodeStore.get(order[next] as string)
      const candidateTurn = candidate === undefined ? undefined : closedTurnOf(candidate)
      if (candidateTurn !== closedTurn) break
      chunk.push(order[next] as string)
      next++
    }
    if (closedTurn === undefined) {
      built.push({ closedTurn: undefined, actionCount: 0, elements: buildElements(chunk, null) })
      index = next
      continue
    }
    // Collect the closed turn's segment; the fold decision below reads the
    // whole turn and hides its work behind one duration line only if the
    // turn exceeds 10 actions.
    const turn = timeline.turns.get(closedTurn)
    const closingSeq = turn?.data.get('turn-tail')?.closing?.finalNode.seq ?? null
    const elements = buildElements(chunk, closingSeq)
    let actionCount = 0
    for (const key of chunk) {
      const node = nodeStore.get(key)
      if (node !== undefined && foldableNode(node, closingSeq)) {
        actionCount++
      }
    }
    built.push({ closedTurn, actionCount, elements })
    index = next
  }
  const foldTotals = new Map<number, number>()
  for (const segment of built) {
    if (segment.closedTurn === undefined) continue
    const turn = timeline.turns.get(segment.closedTurn)
    if (turn?.start?.time === undefined || turn?.end?.time === undefined) continue
    foldTotals.set(
      segment.closedTurn,
      (foldTotals.get(segment.closedTurn) ?? 0) + segment.actionCount,
    )
  }
  const flow: ReactNode[] = []
  // One fold body per turn; the placeholder marks where the single summary
  // renders (at the turn's first fold) and is resolved after the walk.
  const foldBodies = new Map<number, ReactNode[]>()
  const foldSlots = new Map<number, number>()
  for (const segment of built) {
    const turnId = segment.closedTurn
    const total = turnId === undefined ? undefined : foldTotals.get(turnId)
    const folding = turnId !== undefined && total !== undefined && total >= 10
    for (const element of segment.elements) {
      if (folding && element.fold) {
        let body = foldBodies.get(turnId)
        if (body === undefined) {
          body = []
          foldBodies.set(turnId, body)
          foldSlots.set(turnId, flow.length)
          flow.push(null)
        }
        ;(body as ReactNode[]).push(element.el)
      } else {
        flow.push(element.el)
      }
    }
  }
  for (const [turnId, slot] of foldSlots) {
    const turn = timeline.turns.get(turnId)
    const startTime = turn?.start?.time
    const endTime = turn?.end?.time
    /* v8 ignore next -- foldTotals records only turns with both times, so a slot cannot exist without them. */
    if (startTime === undefined || endTime === undefined) continue
    flow[slot] = (
      <TurnWorkSummary
        key={`turn-work:${turnId}`}
        label={t('message.ranFor', { duration: formatRunDuration(endTime - startTime, t) })}
      >
        {foldBodies.get(turnId) ?? []}
      </TurnWorkSummary>
    )
  }

  return (
    <div className={css.root}>
      <div ref={listRef} className={css.scroll}>
        <div ref={columnRef} className={css.column} data-chat-flow="">
          {openState === 'loading' && (
            <div className={css.historySkeleton} role="status" aria-live="polite">
              <span className={a11yCss.visuallyHidden}>{t('chat.loadingHistory')}</span>
              {[82, 64, 74].map((width, index) => (
                <div key={index} className={css.skeletonBubble} style={{ width: `${width}%` }} data-skeleton-bubble="" />
              ))}
            </div>
          )}
          {openState === 'error' && openError !== null && (
            <div className={css.openError}>
              {t('chat.loadError', { message: openError.message, code: openError.code })}
            </div>
          )}
          {hasMore && (
            <div className={css.older}>
              <button type="button" disabled={loadingOlder} onClick={loadOlderAnchored}>
                {loadingOlder ? t('loading') : t('chat.loadOlder')}
              </button>
            </div>
          )}
          {flow}
          {/* No pending placeholders: questions (ui-user-questions) and approvals
              (ApprovalPanel) both take over the composer, so a flow card would
              double-render the same wait. */}
          {/* Turn-level loading signal: rides the whole running turn (first-token
              wait, tool execution, streaming) so it never flickers per step. */}
          {running && <TurnStatus startTime={runningTurnStart} t={t} />}
          {pendingSteering.map(item => (
            <PendingSteeringBubble
              key={item.id}
              content={item.content}
              renderMessageImages={renderMessageImages}
              t={t}
            />
          ))}
        </div>
        {!atBottom && (
          <div className={css.toBottomSlot}>
            <button
              type="button"
              className={css.toBottom}
              aria-label={t('chat.toBottom')}
              onClick={() => {
                const local = listRef.current
                /* v8 ignore next -- ref-null guard: the button only renders alongside the mounted list. */
                if (local !== null) toBottom(scrollerOf(local))
              }}
            >
              <IconChevronDownOutline14 />
            </button>
          </div>
        )}
      </div>
      {fileOpenError !== null && (
        <FileOpenErrorDialog
          path={fileOpenError.path}
          message={fileOpenError.message}
          busy={fileOpenBusy}
          onClose={closeFileOpenError}
          onRetry={() => { requestOpenFile(fileOpenError.path) }}
          t={t}
        />
      )}
    </div>
  )
}

/** In-page Host open-path refusal: the wire reason plus a retry of the same path. */
function FileOpenErrorDialog({
  path, message, busy, onClose, onRetry, t,
}: {
  path: string
  message: string
  busy: boolean
  onClose: () => void
  onRetry: () => void
  t: ChatViewSlotProps['t']
}) {
  return (
    <Modal
      open
      onClose={onClose}
      closeLabel={t('close')}
      title={t(isFolderOpenPath(path) ? 'fileOpen.folderTitle' : 'fileOpen.title')}
      description={message}
      footer={(
        <>
          <Button variant="outline" className={css.modalAction} onClick={onClose}>{t('cancel')}</Button>
          <Button variant="primary" className={css.modalAction} disabled={busy} onClick={onRetry}>{t('retry')}</Button>
        </>
      )}
    />
  )
}
