/**
 * The workspace/session browsing region filling the sidebar shell's
 * `sidebar.workspaces` hole: section header (title + view options + add
 * workspace), search, the grouped tree or flat list, and the workspace
 * dialogs. Wide state renders the full browser; rail state renders add-workspace
 * and search controls plus the durable pinned-session chat icons on the shell's
 * shared rail entry path. The two controls request expansion through the owner
 * share. Adding is the header button's one action, so it raises the directory flow with no
 * menu in between; the flow and its error dialog live in WorkspacePicker
 * (same package — direct composition, no slot between them).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import {
  Button, IconChevronDownOutline14, IconCloseFill14, IconPersonalizationOutline16,
  IconChatOutline16, IconFolderOpen16, IconProjectAddOutline16, IconSearchOutline16, IconTrashOutline16, Menu, Modal, Select, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  SessionId, SessionListState, SessionSearchResultItem, SessionSummary, WorkspaceId, WorkspaceView,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { WorkspaceBrowserProps } from './contract/slots.ts'
import type { SessionNode, SessionOrderBy } from './tree.ts'
import { deriveArchived, deriveFlat, deriveGroups, derivePinned, deriveSearchResults, UNGROUPED_KEY } from './tree.ts'
import {
  ProjectRowItem, SearchResultItem, SessionHoverCard, SessionNodeItem,
  selectSessionMenuEntry, sessionMenuEntries, viewportPointRect,
} from './rows/Rows.tsx'
import { FLAT_SESSION_ORDER_KEY } from './stores.ts'
import type { TouchDragRow } from './touch-drag.ts'
import { useTouchDragList } from './touch-drag.ts'
import { PULL_TRIGGER_PX, usePullToRefresh } from './pull-to-refresh.ts'
import { WorkspacePickFlow } from './WorkspacePicker.tsx'
import {
  ArchiveNotificationStack, type ArchiveNotification, type ArchiveNotificationDraft,
} from './ArchiveNotificationStack.tsx'
import css from './WorkspaceBrowser.module.css'

/**
 * Column slide length (--ds-transition-duration-slow): rail-search focus waits it out —
 * focus() forces a synchronous layout and would jank the slide.
 */
const EXPAND_SLIDE_MS = 300
/** Pause between the latest keystroke and a Host content-search request. */
const SEARCH_DEBOUNCE_MS = 250
/** `session.search` wire bound, measured in JavaScript UTF-16 code units. */
const SEARCH_QUERY_MAX_CODE_UNITS = 500
/** Session rows visible per Workspace before the local overflow control. */
const COLLAPSED_SESSION_LIMIT = 5
/** At most three recent archive outcomes remain in the compact sidebar deck. */
const ARCHIVE_NOTIFICATION_LIMIT = 3

/** Pinned-session navigation that remains available while the sidebar is a rail. */
function PinnedSessionRailItem({
  session, currentSessionId, now, open, renameSession, onRenameRequest, forkSession,
  onMoveSessionRequest, onSessionArchive, onSetSessionPinned, t,
}: {
  session: SessionNode
  currentSessionId: SessionId | undefined
  now: number
  open: (sessionId: SessionId) => void
  renameSession: (sessionId: SessionId, title: string) => Promise<void>
  onRenameRequest: (sessionId: SessionId, currentTitle: string) => void
  forkSession: (sessionId: SessionId) => void
  onMoveSessionRequest: (sessionId: SessionId) => void
  onSessionArchive: (sessionId: SessionId) => void
  onSetSessionPinned: (sessionId: SessionId, pinned: boolean) => void
  t: WorkspaceBrowserProps['t']
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [contextMenuAnchor, setContextMenuAnchor] = useState<DOMRect | null>(null)
  const closeMenu = () => {
    setMenuOpen(false)
    setContextMenuAnchor(null)
  }
  return (
    <SessionHoverCard
      node={session}
      now={now}
      t={t}
      disabled={menuOpen}
      onRename={renameSession}
      anchor={(
        <Menu
          open={menuOpen}
          onClose={closeMenu}
          items={sessionMenuEntries({ pinned: true, onMove: onMoveSessionRequest, onSetPinned: onSetSessionPinned, t })}
          onSelect={(id) => {
            closeMenu()
            selectSessionMenuEntry(id, session, true, {
              onRename: onRenameRequest,
              onFork: forkSession,
              onMove: onMoveSessionRequest,
              onArchive: onSessionArchive,
              onSetPinned: onSetSessionPinned,
            })
          }}
          portal
          closeOnPointerLeave
          {...(contextMenuAnchor === null ? {} : { getAnchorRect: () => contextMenuAnchor })}
          anchor={(
            <button
              type="button"
              className={clsx(css.railPinnedSession, currentSessionId === session.id && css.railPinnedSessionCurrent)}
              aria-label={t('rail.pinnedSession.aria', { name: session.title })}
              aria-current={currentSessionId === session.id ? 'page' : undefined}
              onClick={() => { open(session.id) }}
              onContextMenu={(event) => {
                event.preventDefault()
                event.stopPropagation()
                const buttonRect = event.currentTarget.getBoundingClientRect()
                const keyboardAnchor = event.clientX === 0 && event.clientY === 0
                setContextMenuAnchor(viewportPointRect(
                  keyboardAnchor ? buttonRect.left + 8 : event.clientX,
                  keyboardAnchor ? buttonRect.bottom : event.clientY,
                ))
                setMenuOpen(true)
              }}
            >
              <IconChatOutline16 size={18} />
            </button>
          )}
        />
      )}
    />
  )
}

/** Pinned-session navigation that remains available while the sidebar is a rail. */
function PinnedSessionRail({
  sessions, currentSessionId, open, renameSession, onRenameRequest, forkSession,
  onMoveSessionRequest, onSessionArchive, onSetSessionPinned, t,
}: {
  sessions: readonly SessionNode[]
  currentSessionId: SessionId | undefined
  open: (sessionId: SessionId) => void
  renameSession: (sessionId: SessionId, title: string) => Promise<void>
  onRenameRequest: (sessionId: SessionId, currentTitle: string) => void
  forkSession: (sessionId: SessionId) => void
  onMoveSessionRequest: (sessionId: SessionId) => void
  onSessionArchive: (sessionId: SessionId) => void
  onSetSessionPinned: (sessionId: SessionId, pinned: boolean) => void
  t: WorkspaceBrowserProps['t']
}) {
  if (sessions.length === 0) return null
  const now = Date.now()
  return (
    <nav className={css.railPinnedSessions} aria-label={t('section.pinned')}>
      {sessions.map(session => (
        <PinnedSessionRailItem
          key={session.id}
          session={session}
          currentSessionId={currentSessionId}
          now={now}
          open={open}
          renameSession={renameSession}
          onRenameRequest={onRenameRequest}
          forkSession={forkSession}
          onMoveSessionRequest={onMoveSessionRequest}
          onSessionArchive={onSessionArchive}
          onSetSessionPinned={onSetSessionPinned}
          t={t}
        />
      ))}
    </nav>
  )
}

/** Keep controlled input and RPC payload inside the session.search wire contract. */
function sanitizeSearchQuery(value: string): string {
  const withoutNul = value.replaceAll('\0', '')
  if (withoutNul.length <= SEARCH_QUERY_MAX_CODE_UNITS) return withoutNul
  let end = SEARCH_QUERY_MAX_CODE_UNITS
  const last = withoutNul.charCodeAt(end - 1)
  const next = withoutNul.charCodeAt(end)
  if (last >= 0xD800 && last <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF) end--
  return withoutNul.slice(0, end)
}

/** Immutable membership toggle for the local expand-all array. */
function toggled(list: readonly string[], key: string): string[] {
  return list.includes(key) ? list.filter(k => k !== key) : [...list, key]
}

/**
 * Accept the native drag at document level while a row drag is active: row
 * hover still owns the insertion marker, and releasing outside the list must
 * not be rendered as a rejected drop before dragend commits that last marker.
 */
function useNativeDragAcceptance(active: boolean): void {
  useEffect(() => {
    if (!active) return
    const acceptDrag = (event: DragEvent): void => {
      event.preventDefault()
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'move'
    }
    const acceptDrop = (event: DragEvent): void => { event.preventDefault() }
    document.addEventListener('dragover', acceptDrag)
    document.addEventListener('drop', acceptDrop)
    return () => {
      document.removeEventListener('dragover', acceptDrag)
      document.removeEventListener('drop', acceptDrop)
    }
  }, [active])
}

/** Reconcile a stored view order with the Workspace's current session account. */
function reconciledSessionOrder(sessionIds: readonly SessionId[], stored: readonly string[] | undefined): SessionId[] {
  if (stored === undefined) return [...sessionIds]
  const byId = new Map(sessionIds.map(id => [id as string, id]))
  const ordered: SessionId[] = []
  const included = new Set<string>()
  for (const key of stored) {
    const id = byId.get(key)
    if (id === undefined || included.has(key)) continue
    ordered.push(id)
    included.add(key)
  }
  for (const id of sessionIds) {
    if (included.has(id)) continue
    ordered.push(id)
  }
  return ordered
}

/** Newest update first with stable Session identity as the tie-break. */
function compareSessionRecency(a: SessionId, b: SessionId, byId: SessionListState['byId']): number {
  const aUpdatedAt = byId[a]?.updatedAt ?? Number.NEGATIVE_INFINITY
  const bUpdatedAt = byId[b]?.updatedAt ?? Number.NEGATIVE_INFINITY
  if (bUpdatedAt !== aUpdatedAt) return bUpdatedAt - aUpdatedAt
  return b.localeCompare(a)
}

/** Pure recent-update promotion: move updated sessions to the top while preserving relative recency. */
function promotedSessionOrder(currentOrder: readonly SessionId[], byId: SessionListState['byId'], previousUpdatedAt: Readonly<Record<string, number>>): SessionId[] {
  const promoted: SessionId[] = []
  const unchanged: SessionId[] = []
  for (const id of currentOrder) {
    const current = byId[id]?.updatedAt
    const previous = previousUpdatedAt[id]
    if (current !== undefined && previous !== undefined && current > previous) {
      promoted.push(id)
    } else {
      unchanged.push(id)
    }
  }
  promoted.sort((a, b) => compareSessionRecency(a, b, byId))
  return [...promoted, ...unchanged]
}

/** Compute the next session order account and its snapshot of last-seen timestamps. */
function nextSessionOrderAccount(params: {
  sessionIds: readonly SessionId[]
  byId: SessionListState['byId']
  previousOrder: readonly string[] | undefined
  previousUpdatedAt: Readonly<Record<string, number>>
  switchedToUpdated: boolean
  promoteUpdates: boolean
}): { order: string[]; updatedAt: Record<string, number>; changed: boolean } {
  const { sessionIds, byId, previousOrder, previousUpdatedAt, switchedToUpdated, promoteUpdates } = params
  const reconciled = reconciledSessionOrder(sessionIds, previousOrder)
  const orderIds = switchedToUpdated
    ? [...reconciled].sort((a, b) => compareSessionRecency(a, b, byId))
    : promoteUpdates
      ? promotedSessionOrder(reconciled, byId, previousUpdatedAt)
      : reconciled
  const order = orderIds.map(id => id as string)
  const updatedAt: Record<string, number> = {}
  for (const id of sessionIds) {
    const ts = byId[id]?.updatedAt
    if (ts !== undefined) updatedAt[id] = ts
  }
  const orderChanged = previousOrder === undefined
    || order.length !== previousOrder.length
    || order.some((id, index) => id !== previousOrder[index])
  const timestampsChanged = Object.keys(updatedAt).length !== Object.keys(previousUpdatedAt).length
    || Object.entries(updatedAt).some(([id, timestamp]) => previousUpdatedAt[id] !== timestamp)
  return { order, updatedAt, changed: orderChanged || timestampsChanged }
}

function ViewOptionsMenu({ groupBy, orderBy, view, onGroupPick, onOrderPick, onViewPick, t }: {
  groupBy: 'workspace' | 'flat'
  orderBy: SessionOrderBy
  view: 'all' | 'attention' | 'archived'
  onGroupPick: (mode: 'workspace' | 'flat') => void
  onOrderPick: (mode: SessionOrderBy) => void
  onViewPick: (view: 'all' | 'attention' | 'archived') => void
  t: WorkspaceBrowserProps['t']
}) {
  const [open, setOpen] = useState(false)
  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      items={[
        { type: 'label' as const, id: 'group-by', text: t('groupBy.label') },
        { id: 'workspace', label: t('groupBy.workspace') },
        { id: 'flat', label: t('groupBy.flat') },
        { type: 'separator' as const, id: 'order-by-separator' },
        { type: 'label' as const, id: 'order-by', text: t('orderBy.label') },
        { id: 'manual', label: t('orderBy.manual') },
        { id: 'updated', label: t('orderBy.updated') },
        { type: 'separator' as const, id: 'session-view-separator' },
        { id: 'all', label: t('filter.all') },
        { id: 'attention', label: t('filter.attention') },
        { id: 'archived', label: t('filter.archived') },
      ]}
      selectedIds={[groupBy, orderBy, ...(view === 'all' ? [] : [view])]}
      onSelect={(id) => {
        if (id === 'workspace' || id === 'flat') onGroupPick(id)
        else if (id === 'manual' || id === 'updated') onOrderPick(id)
        else if (id === 'all' || id === 'attention' || id === 'archived') onViewPick(id)
        setOpen(false)
      }}
      align="end"
      dense
      // Portal: the section header clips overflow, so an in-place list would
      // be cut off at the header's bounds.
      portal
      anchor={(
        <Tooltip label={t('viewOptions.label')} side="bottom" delayMs={500}>
          <button
            type="button"
            className={clsx(css.iconButton, css.wide)}
            aria-label={t('viewOptions.label')}
            onClick={() => { setOpen(v => !v) }}
          >
            <IconPersonalizationOutline16 />
          </button>
        </Tooltip>
      )}
    />
  )
}

/** A session belongs in the global attention view when any authoritative session fact needs an operator. */
function needsAttention(node: SessionNode): boolean {
  return node.pendingInteraction !== undefined
    || node.attention !== undefined
    || node.completed
    || node.running
    || node.runningSubagentCount > 0
}

/** Global attention projection: a filtered session-list view, never a DOM scan. */
function AttentionList({
  useSessions, open, renameSession, onSessionRename, forkSession, onMoveSessionRequest, onSessionArchive, archivedSessionIds, t,
}: Pick<
  SessionTreeProps,
  'useSessions' | 'open' | 'renameSession' | 'onSessionRename' | 'forkSession' | 'onMoveSessionRequest' | 'onSessionArchive' | 't'
> & { archivedSessionIds: readonly SessionId[] }) {
  const list = useSessions(state => state)
  const rows = useMemo(
    () => deriveFlat(list, archivedSessionIds, []).filter(needsAttention),
    [list, archivedSessionIds],
  )
  const now = Date.now()
  return (
    <div className={clsx(css.treeBody, css.wide)}>
      <div className={css.list} role="tree" aria-label={t('section.attention')} data-pull-scroll-root="">
        {rows.length === 0 && <div className={css.empty}>{t('empty.none')}</div>}
        {rows.map(node => (
          <SessionNodeItem key={node.id} node={node} currentId={list.current} now={now}
            onOpen={open} onRename={onSessionRename} onFork={forkSession}
            onMove={onMoveSessionRequest} onArchive={onSessionArchive} onInlineRename={renameSession} flat t={t}
          />
        ))}
      </div>
      <span className={css.fade} />
    </div>
  )
}

/** Archive projection with a restore and delete action for every retained session summary. */
function ArchivedList({ list, archivedSessionIds, open, renameSession, onRestore, onDelete, onDeleteAll, t }: {
  list: SessionListState
  archivedSessionIds: readonly SessionId[]
  open: SessionTreeProps['open']
  renameSession: WorkspaceBrowserProps['renameSession']
  onRestore: (id: SessionId) => void
  onDelete: (id: SessionId) => void
  onDeleteAll: () => void
  t: WorkspaceBrowserProps['t']
}) {
  const rows = useMemo(() => deriveArchived(list, archivedSessionIds), [list, archivedSessionIds])
  const now = Date.now()
  return (
    <div className={clsx(css.treeBody, css.wide)}>
      <div className={css.list} role="tree" aria-label={t('section.archived')} data-pull-scroll-root="">
        {rows.length === 0 && <div className={css.empty}>{t('empty.none')}</div>}
        {rows.length > 0 && (
          <div className={css.archivedHeader}>
            <div className={css.categoryLabel}>{t('section.archived')}</div>
            <button
              type="button"
              className={css.deleteAllButton}
              onClick={onDeleteAll}
              aria-label={t('delete.allArchived')}
              title={t('delete.allArchived')}
            >
              <IconTrashOutline16 size={14} />
            </button>
          </div>
        )}
        {rows.map(node => (
          <SessionNodeItem key={node.id} node={node} currentId={list.current} now={now}
            onOpen={open} onRename={() => {}} onFork={() => {}} onArchive={() => {}}
            archived onRestore={onRestore} onDelete={onDelete} onInlineRename={renameSession} flat t={t}
          />
        ))}
      </div>
      <span className={css.fade} />
    </div>
  )
}

/** In-flight root-row drag: source identity plus the current insert marker. */
interface DragState {
  /** Workspace id, or {@link UNGROUPED_KEY} for the browser-local loose-session account. */
  accountKey: string
  sessionId: SessionNode['id']
  /** Row the marker sits on and which half (insert above/below it). */
  over: { id: SessionNode['id']; half: 'before' | 'after' } | null
}

/** In-flight Workspace-row drag: source identity plus the current marker. */
interface WorkspaceDragState {
  workspaceId: WorkspaceId
  over: { id: WorkspaceId; half: 'before' | 'after' } | null
}

/** Resolve an insertion side from the full rendered workspace group. */
function workspaceGroupHalf(e: { clientY: number; currentTarget: HTMLElement }): 'before' | 'after' {
  const rect = e.currentTarget.getBoundingClientRect()
  return e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
}

type SessionTreeProps = Pick<
  WorkspaceBrowserProps,
  'useSessions' | 'startSession' | 'open' | 'renameSession' | 'forkSession'
  | 'insertWorkspaceBefore' | 'insertSessionBefore' | 't'
> & {
  /** Host account home for POSIX hover-path abbreviation. */
  home?: string | undefined
  workspaces: readonly WorkspaceView[]
  /** Explicit persisted zero-or-five-session state by Workspace group. */
  groupExpansion: Readonly<Record<string, boolean>>
  /** Persist one Workspace group's zero-or-five-session state. */
  setGroupExpanded: (key: string, expanded: boolean) => void
  /** Shared editable orders used by Workspace groups and the flat-list account. */
  sessionOrderByAccount: Readonly<Record<string, readonly string[]>>
  /** Last update timestamps observed for one-time recent-update promotions. */
  sessionUpdatedAtByAccount: Readonly<Record<string, Readonly<Record<string, number>>>>
  /** Replace one shared order and its observed timestamps. */
  syncSessionOrderAccount: (accountKey: string, order: string[], updatedAt: Record<string, number>) => void
  /** Apply a drag to one shared order. */
  setSessionOrder: (accountKey: string, order: string[]) => void
  /** Registry-global archive set (hidden rows). */
  archivedSessionIds: readonly SessionNode['id'][]
  /** Registry-global sidebar pins in durable pin order. */
  pinnedSessionIds: readonly SessionNode['id'][]
  /** Open the browser-owned rename dialog for a real Workspace group. */
  onRenameRequest: (workspaceId: WorkspaceId, currentTitle: string) => void
  /** Open the browser-owned delete-confirmation dialog for a real Workspace group. */
  onDeleteRequest: (workspaceId: WorkspaceId, currentTitle: string) => void
  /** Open the browser-owned settings dialog for a real Workspace group. */
  onSettingsRequest: (workspaceId: WorkspaceId, title: string) => void
  /** Open the browser-owned session rename dialog. */
  onSessionRename: (sessionId: SessionNode['id'], currentTitle: string) => void
  /** Open the browser-owned move session dialog. */
  onMoveSessionRequest: (sessionId: SessionNode['id']) => void
  /** Archive a session (row menu action; the row disappears on the state echo). */
  onSessionArchive: (sessionId: SessionNode['id']) => void
  /** Set one session's durable pin membership. */
  onSetSessionPinned: (sessionId: SessionNode['id'], pinned: boolean) => void
  /** Session order behavior: fixed after edits, or additionally promoted by user activity. */
  orderBy: SessionOrderBy
}

/** Pending-baseline preview: the eventual Workspace/Session hierarchy without unavailable labels. */
function ListSkeleton() {
  const rows = [
    { kind: 'workspace', width: 58 },
    { kind: 'session', width: 76 },
    { kind: 'session', width: 52 },
    { kind: 'workspace', width: 64 },
    { kind: 'session', width: 68 },
  ] as const
  return (
    <div className={css.listSkeleton} aria-hidden="true" data-list-skeleton="">
      {rows.map((row, index) => (
        <div
          key={index}
          className={row.kind === 'workspace' ? css.listSkeletonWorkspace : css.listSkeletonSession}
          data-list-skeleton-row={row.kind}
        >
          <span className={css.listSkeletonIcon}>
            {row.kind === 'workspace' ? <IconFolderOpen16 /> : <IconChatOutline16 />}
          </span>
          <span className={css.listSkeletonLabel} style={{ width: `${row.width}%` }} />
        </div>
      ))}
    </div>
  )
}

/** Duration of the workspace folder disclosure's open and close transition. */
const WORKSPACE_DISCLOSURE_MS = 220

/**
 * Retains a group's last visible rows through its closing motion. The folded
 * run is inert and hidden from assistive technology before its height starts
 * shrinking, so closing a Workspace cannot leave a clipped row focusable.
 * @param props.expanded - whether the Workspace group is logically open.
 * @param props.children - the current group's visible rows and overflow control.
 * @returns an animated group body, or nothing once a fold has settled.
 */
function WorkspaceGroupDisclosure({ expanded, children }: { expanded: boolean; children: ReactNode }) {
  const [closing, setClosing] = useState(false)
  const priorExpanded = useRef(expanded)
  const lastOpenChildren = useRef(children)

  if (expanded) {
    lastOpenChildren.current = children
  }

  useLayoutEffect(() => {
    if (priorExpanded.current === expanded) return
    priorExpanded.current = expanded
    if (expanded) {
      setClosing(false)
      return
    }
    setClosing(true)
    const timer = window.setTimeout(() => { setClosing(false) }, WORKSPACE_DISCLOSURE_MS)
    return () => { window.clearTimeout(timer) }
  }, [expanded])

  const visible = expanded || closing
  if (!visible) return null
  const open = expanded && !closing

  return (
    <div
      className={clsx(css.groupDisclosure, open && css.groupDisclosureOpen)}
      data-workspace-disclosure=""
      aria-hidden={open ? undefined : 'true'}
      ref={(element) => { if (element !== null) element.inert = !open }}
    >
      <div className={css.groupDisclosureBody}>{open ? children : lastOpenChildren.current}</div>
    </div>
  )
}

/** The scrolling session tree; unmounting drops the sessions subscription and expand-all state. */
function SessionTree({
  useSessions, startSession, open, renameSession, forkSession, workspaces, archivedSessionIds, pinnedSessionIds,
  onRenameRequest, onDeleteRequest, onSettingsRequest, onSessionRename, onMoveSessionRequest,
  onSessionArchive, onSetSessionPinned,
  insertWorkspaceBefore, insertSessionBefore, orderBy,
  groupExpansion, setGroupExpanded,
  sessionOrderByAccount, sessionUpdatedAtByAccount, syncSessionOrderAccount, setSessionOrder, home, t,
}: SessionTreeProps) {
  const list = useSessions(s => s)
  const current = list.current
  const [expandedSessionGroups, setExpandedSessionGroups] = useState<string[]>([])
  // Transient drag marker state; the selected mode owns the resulting order.
  const [drag, setDrag] = useState<DragState | null>(null)
  const sessionDropCommitted = useRef(false)
  const [workspaceDrag, setWorkspaceDrag] = useState<WorkspaceDragState | null>(null)
  const workspaceDropCommitted = useRef(false)
  const previousOrderBy = useRef(orderBy)
  const nativeDragActive = drag !== null || workspaceDrag !== null
  useNativeDragAcceptance(nativeDragActive)
  const touchDrag = useTouchDragList()
  touchDrag.registry.clear()
  const currentGroup = current === undefined
    ? undefined
    : (workspaces.find(w => w.sessionIds.includes(current))?.workspaceId as string | undefined)
      ?? UNGROUPED_KEY
  useEffect(() => {
    if (current === undefined || currentGroup === undefined || Object.hasOwn(groupExpansion, currentGroup)) return
    setGroupExpanded(currentGroup, true)
  }, [current, currentGroup, setGroupExpanded, groupExpansion])
  const expandedGroups = useMemo(
    () => Object.entries(groupExpansion).filter(([, expanded]) => expanded).map(([key]) => key),
    [groupExpansion],
  )
  const ungroupedSessionIds = useMemo(() => {
    const accounted = new Set(workspaces.flatMap(workspace => workspace.sessionIds))
    return list.ids.filter(id => list.byId[id] !== undefined && !accounted.has(id))
  }, [list, workspaces])
  useEffect(() => {
    if (list.phase !== 'ready') return
    const switchedToUpdated = previousOrderBy.current !== 'updated' && orderBy === 'updated'
    previousOrderBy.current = orderBy
    const accounts = [
      ...workspaces.map(workspace => ({
        key: workspace.workspaceId as string,
        sessionIds: workspace.sessionIds.filter(id => list.byId[id] !== undefined),
      })),
      { key: UNGROUPED_KEY, sessionIds: ungroupedSessionIds },
    ]
    for (const { key, sessionIds } of accounts) {
      const previousOrder = sessionOrderByAccount[key]
      const previousUpdatedAt = sessionUpdatedAtByAccount[key] ?? {}
      const next = nextSessionOrderAccount({
        sessionIds,
        byId: list.byId,
        previousOrder,
        previousUpdatedAt,
        switchedToUpdated,
        promoteUpdates: orderBy === 'updated',
      })
      if (next.changed) {
        syncSessionOrderAccount(key, next.order, next.updatedAt)
      }
    }
  }, [list, orderBy, sessionOrderByAccount, sessionUpdatedAtByAccount, syncSessionOrderAccount, ungroupedSessionIds, workspaces])
  const orderedWorkspaces = useMemo(() => {
    return workspaces.map((workspace) => {
      const stored = sessionOrderByAccount[workspace.workspaceId as string]
      const sessionIds = reconciledSessionOrder(workspace.sessionIds, stored)
      return { ...workspace, sessionIds }
    })
  }, [sessionOrderByAccount, workspaces])
  const orderedUngroupedSessionIds = useMemo(
    () => reconciledSessionOrder(ungroupedSessionIds, sessionOrderByAccount[UNGROUPED_KEY]),
    [sessionOrderByAccount, ungroupedSessionIds],
  )
  const groups = useMemo(
    () => deriveGroups(list, orderedWorkspaces, archivedSessionIds, {
      expandedGroups: expandedGroups.includes(UNGROUPED_KEY)
        ? expandedGroups
        : [...expandedGroups, UNGROUPED_KEY],
      ...(sessionOrderByAccount[UNGROUPED_KEY] === undefined
        ? {}
        : { ungroupedOrder: sessionOrderByAccount[UNGROUPED_KEY] }),
    }, pinnedSessionIds),
    [list, orderedWorkspaces, archivedSessionIds, pinnedSessionIds, expandedGroups, sessionOrderByAccount],
  )
  const pinnedRows = useMemo(
    () => derivePinned(list, pinnedSessionIds, archivedSessionIds),
    [list, pinnedSessionIds, archivedSessionIds],
  )
  const now = Date.now()
  const commitSessionDrag = (activeDrag: DragState, over: NonNullable<DragState['over']>): void => {
    if (sessionDropCommitted.current) return
    sessionDropCommitted.current = true
    setDrag(null)
    const group = groups.find(candidate => candidate.key === activeDrag.accountKey)
    if (group === undefined) return
    const targetIndex = group.sessions.findIndex(session => session.id === over.id)
    if (targetIndex === -1) return
    const anchor = over.half === 'before' ? over.id : group.sessions[targetIndex + 1]?.id
    if (anchor === activeDrag.sessionId) return
    const sourceIndex = group.sessions.findIndex(session => session.id === activeDrag.sessionId)
    const anchorIndex = anchor === undefined
      ? group.sessions.length
      : group.sessions.findIndex(session => session.id === anchor)
    if (sourceIndex !== -1 && (anchorIndex === sourceIndex || anchorIndex === sourceIndex + 1)) return
    const accountSessionIds = activeDrag.accountKey === UNGROUPED_KEY
      ? orderedUngroupedSessionIds
      : orderedWorkspaces.find(workspace => workspace.workspaceId === activeDrag.accountKey)?.sessionIds
    if (accountSessionIds === undefined) return
    const nextOrder = accountSessionIds.filter(id => id !== activeDrag.sessionId)
    const insertAt = anchor === undefined ? nextOrder.length : nextOrder.indexOf(anchor)
    nextOrder.splice(insertAt === -1 ? nextOrder.length : insertAt, 0, activeDrag.sessionId)
    setSessionOrder(activeDrag.accountKey, nextOrder.map(id => id as string))
    if (orderBy === 'updated' || activeDrag.accountKey === UNGROUPED_KEY) return
    insertSessionBefore(activeDrag.accountKey as WorkspaceId, activeDrag.sessionId, anchor).catch((reason: unknown) => {
      console.warn('session reorder rejected:', reason)
    })
  }
  const commitWorkspaceDrag = (
    activeDrag: WorkspaceDragState,
    over: NonNullable<WorkspaceDragState['over']>,
  ): void => {
    if (workspaceDropCommitted.current) return
    workspaceDropCommitted.current = true
    setWorkspaceDrag(null)
    const rowIndex = workspaces.findIndex(workspace => workspace.workspaceId === over.id)
    if (rowIndex === -1) return
    const anchor = over.half === 'before' ? over.id : workspaces[rowIndex + 1]?.workspaceId
    if (anchor === activeDrag.workspaceId) return
    const sourceIndex = workspaces.findIndex(workspace => workspace.workspaceId === activeDrag.workspaceId)
    const anchorIndex = anchor === undefined
      ? workspaces.length
      : workspaces.findIndex(workspace => workspace.workspaceId === anchor)
    if (sourceIndex !== -1 && (anchorIndex === sourceIndex || anchorIndex === sourceIndex + 1)) return
    insertWorkspaceBefore(activeDrag.workspaceId, anchor).catch((reason: unknown) => {
      console.warn('workspace reorder rejected:', reason)
    })
  }
  const workspaceDropAtListStart = groups[0]?.workspaceId !== undefined
    && workspaceDrag?.over?.id === groups[0].workspaceId
    && workspaceDrag.over.half === 'before'

  return (
    <div className={clsx(css.treeBody, css.wide)}>
      {workspaceDropAtListStart && <span className={css.listTopDropIndicator} aria-hidden="true" />}
      <div
        className={clsx(css.list, workspaceDropAtListStart && css.listTopDropActive)}
        role="tree"
        aria-label={t('section.sessions')}
        data-pull-scroll-root=""
        onPointerDown={touchDrag.onPointerDown}
        onClickCapture={touchDrag.onClickCapture}
      >
        {groups.length === 0 && pinnedRows.length === 0 && (list.phase !== 'ready'
          ? <ListSkeleton />
          : <div className={css.empty}>{t('empty.none')}</div>)}
        {pinnedRows.length > 0 && (
          <section className={css.categorySection} aria-label={t('section.pinned')}>
            <div className={css.categoryLabel}>{t('section.pinned')}</div>
            {pinnedRows.map(node => (
              <SessionNodeItem
                key={node.id}
                node={node}
                currentId={current}
                now={now}
                onOpen={open}
                onRename={onSessionRename}
                onFork={forkSession}
                onMove={onMoveSessionRequest}
                onArchive={onSessionArchive}
                onInlineRename={renameSession}
                pinned
                onSetPinned={onSetSessionPinned}
                t={t}
              />
            ))}
          </section>
        )}
        {groups.some(group => group.workspaceId !== undefined) && (
          <div className={css.categoryLabel}>{t('section.workspaces')}</div>
        )}
        {groups.map((group) => {
          const workspaceId = group.workspaceId
          const workspaceMarker = workspaceId !== undefined && workspaceDrag?.over?.id === workspaceId
            ? workspaceDrag.over.half
            : null
          const workspaceDragProps = workspaceId === undefined ? undefined : {
            start: () => {
              workspaceDropCommitted.current = false
              setWorkspaceDrag({ workspaceId, over: null })
            },
            end: () => {
              if (workspaceDrag?.over !== null && workspaceDrag?.over !== undefined) {
                commitWorkspaceDrag(workspaceDrag, workspaceDrag.over)
              } else {
                setWorkspaceDrag(null)
              }
              workspaceDropCommitted.current = false
            },
          }
          // Touch-drag target for the workspace header row.
          if (workspaceDragProps !== undefined) {
            /* v8 ignore next -- narrowing guard: the outer scope also guarded workspaceId !== undefined. */
            const wid = workspaceId as WorkspaceId
            touchDrag.registry.set(`w:${group.key}`, {
              id: `w:${group.key}`,
              start: workspaceDragProps.start,
              hover: (half: 'before' | 'after') => {
                setWorkspaceDrag(active => active === null
                  ? active
                  : { ...active, over: { id: wid, half } })
              },
              end: workspaceDragProps.end,
            } satisfies TouchDragRow)
          }
          const hoverWorkspace = workspaceId === undefined
            ? undefined
            : (half: 'before' | 'after') => {
              setWorkspaceDrag(active => active === null
                ? active
                : { ...active, over: { id: workspaceId, half } })
            }
          const dropWorkspace = workspaceId === undefined
            ? undefined
            : (half: 'before' | 'after') => {
              if (workspaceDrag === null) return
              commitWorkspaceDrag(workspaceDrag, { id: workspaceId, half })
            }
          return (
          // Group section: header row + expanded top-level session rows. The
          // inter-group breathing room is the section's own margin
          // (WorkspaceBrowser.module.css).
            <div
              key={group.key}
              className={clsx(
                css.groupSection,
                workspaceMarker === 'before' && css.workspaceDropBefore,
                workspaceMarker === 'after' && css.workspaceDropAfter,
              )}
              onDragOver={workspaceDrag === null || hoverWorkspace === undefined
                ? undefined
                : (e) => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  hoverWorkspace(workspaceGroupHalf(e))
                }}
              onDrop={workspaceDrag === null || dropWorkspace === undefined
                ? undefined
                : (e) => {
                  e.preventDefault()
                  dropWorkspace(workspaceGroupHalf(e))
                }}
            >
              {group.workspaceId === undefined
                ? <div className={css.categoryLabel}>{t('section.ungrouped')}</div>
                : <ProjectRowItem
                  group={group}
                  home={home}
                  t={t}
                  onToggle={() => {
                    if (group.expanded) {
                      setExpandedSessionGroups(keys => keys.filter(key => key !== group.key))
                    }
                    setGroupExpanded(group.key, !group.expanded)
                  }}
                  onCreate={() => {
                    if (group.workspaceId !== undefined) {
                      setGroupExpanded(group.key, true)
                      startSession(group.workspaceId)
                    }
                  }}
                  drag={workspaceDragProps}
                  actions={{
                    rename: () => {
                    /* v8 ignore next -- narrowing guard: the actions object exists only for real-workspace groups. */
                      if (group.workspaceId !== undefined) onRenameRequest(group.workspaceId, group.label)
                    },
                    settings: () => {
                    /* v8 ignore next -- narrowing guard: the actions object exists only for real-workspace groups. */
                      if (group.workspaceId !== undefined) onSettingsRequest(group.workspaceId, group.label)
                    },
                    delete: () => {
                    /* v8 ignore next -- narrowing guard: the actions object exists only for real-workspace groups. */
                      if (group.workspaceId !== undefined) onDeleteRequest(group.workspaceId, group.label)
                    },
                  }}
                />}
              <WorkspaceGroupDisclosure expanded={group.expanded}>
                {group.sessionCount === 0 && <div className={css.groupEmpty}>{t('empty.workspace')}</div>}
                {(expandedSessionGroups.includes(group.key)
                  ? group.sessions
                  : group.sessions.slice(0, COLLAPSED_SESSION_LIMIT)
                ).map((node) => {
              // Session drag never leaves its group. Ungrouped writes only the
              // browser-local account; real Workspaces may also write Host order.
                const sameGroupDrag = drag !== null && drag.accountKey === group.key
                const dragProps = {
                  start: () => {
                    sessionDropCommitted.current = false
                    setDrag({ accountKey: group.key, sessionId: node.id, over: null })
                  },
                  active: sameGroupDrag,
                  marker: sameGroupDrag && drag.over?.id === node.id ? drag.over.half : null,
                  hover: (half: 'before' | 'after') => {
                  /* v8 ignore next -- narrowing guard: Rows gates hover on `active`, which is false while the drag state is null. */
                    setDrag(d => (d === null ? d : { ...d, over: { id: node.id, half } }))
                  },
                  drop: (half: 'before' | 'after') => {
                  /* v8 ignore next -- narrowing guard: Rows gates drop on `active`, which is false while the drag state is null. */
                    if (drag === null) return
                    commitSessionDrag(drag, { id: node.id, half })
                  },
                  end: () => {
                    if (drag?.over !== null && drag?.over !== undefined) commitSessionDrag(drag, drag.over)
                    else setDrag(null)
                    sessionDropCommitted.current = false
                  },
                }
                // Touch-drag target sharing the same start/hover/end closures.
                touchDrag.registry.set(`s:${node.id as string}`, {
                  id: `s:${node.id as string}`,
                  start: dragProps.start,
                  hover: dragProps.hover,
                  end: dragProps.end,
                } satisfies TouchDragRow)
                return (
                  <SessionNodeItem
                    key={node.id}
                    node={node}
                    currentId={current}
                    now={now}
                    onOpen={open}
                    onRename={onSessionRename}
                    onFork={forkSession}
                    onMove={onMoveSessionRequest}
                    onArchive={onSessionArchive}
                    onInlineRename={renameSession}
                    pinned={false}
                    onSetPinned={onSetSessionPinned}
                    drag={dragProps}
                    t={t}
                  />
                )
                })}
                {group.sessions.length > COLLAPSED_SESSION_LIMIT && (
                  <button
                    type="button"
                    className={css.sessionOverflowButton}
                    aria-expanded={expandedSessionGroups.includes(group.key)}
                    onClick={() => { setExpandedSessionGroups(keys => toggled(keys, group.key)) }}
                  >
                    {expandedSessionGroups.includes(group.key)
                      ? t('sessions.collapse')
                      : t('sessions.expand', { n: group.sessions.length - COLLAPSED_SESSION_LIMIT })}
                  </button>
                )}
              </WorkspaceGroupDisclosure>
            </div>
          )
        })}
      </div>
      <span className={css.fade} />
    </div>
  )
}

/** The flat "In one list" body: every session is one draggable top-level row. */
function FlatList({
  useSessions, open, renameSession, forkSession, onSessionRename, onMoveSessionRequest, onSessionArchive, archivedSessionIds,
  pinnedSessionIds, onSetSessionPinned, orderBy, sessionOrderByAccount,
  sessionUpdatedAtByAccount, syncSessionOrderAccount, setSessionOrder, t,
}: Pick<
  SessionTreeProps,
  | 'useSessions'
  | 'open'
  | 'renameSession'
  | 'forkSession'
  | 'onSessionRename'
  | 'onMoveSessionRequest'
  | 'onSessionArchive'
  | 'archivedSessionIds'
  | 'pinnedSessionIds'
  | 'onSetSessionPinned'
  | 'orderBy'
  | 'sessionOrderByAccount'
  | 'sessionUpdatedAtByAccount'
  | 'syncSessionOrderAccount'
  | 'setSessionOrder'
  | 't'
>) {
  const list = useSessions(s => s)
  const baseRows = useMemo(
    () => deriveFlat(list, archivedSessionIds, pinnedSessionIds),
    [list, archivedSessionIds, pinnedSessionIds],
  )
  const pinnedRows = useMemo(
    () => derivePinned(list, pinnedSessionIds, archivedSessionIds),
    [list, pinnedSessionIds, archivedSessionIds],
  )
  const currentBlankId = useMemo(() => {
    const cur = list.current
    return cur !== undefined && list.byId[cur]?.blank === true && !archivedSessionIds.includes(cur)
      ? cur
      : undefined
  }, [list.current, list.byId, archivedSessionIds])
  const sessionIds = useMemo(() => {
    const base = baseRows.map(row => row.id)
    return currentBlankId !== undefined && !base.includes(currentBlankId)
      ? [currentBlankId, ...base]
      : base
  }, [baseRows, currentBlankId])
  const previousOrderBy = useRef(orderBy)
  useEffect(() => {
    if (list.phase !== 'ready') return
    const previousOrder = sessionOrderByAccount[FLAT_SESSION_ORDER_KEY]
    const previousUpdatedAt = sessionUpdatedAtByAccount[FLAT_SESSION_ORDER_KEY] ?? {}
    const switchedToUpdated = previousOrderBy.current !== 'updated' && orderBy === 'updated'
    previousOrderBy.current = orderBy
    const next = nextSessionOrderAccount({
      sessionIds,
      byId: list.byId,
      previousOrder,
      previousUpdatedAt,
      switchedToUpdated,
      promoteUpdates: orderBy === 'updated',
    })
    if (next.changed) {
      syncSessionOrderAccount(FLAT_SESSION_ORDER_KEY, next.order, next.updatedAt)
    }
  }, [list, orderBy, sessionOrderByAccount, sessionUpdatedAtByAccount, sessionIds, syncSessionOrderAccount])
  const rows = useMemo(() => {
    const byId = new Map(baseRows.map(row => [row.id, row]))
    return reconciledSessionOrder(sessionIds, sessionOrderByAccount[FLAT_SESSION_ORDER_KEY])
      .flatMap((id) => {
        const row = byId.get(id)
        return row === undefined ? [] : [row]
      })
  }, [baseRows, sessionOrderByAccount, sessionIds])
  const [drag, setDrag] = useState<DragState | null>(null)
  const dropCommitted = useRef(false)
  useNativeDragAcceptance(drag !== null)
  const touchDrag = useTouchDragList()
  touchDrag.registry.clear()
  const commitDrag = (activeDrag: DragState, over: NonNullable<DragState['over']>): void => {
    if (dropCommitted.current) return
    dropCommitted.current = true
    setDrag(null)
    const targetIndex = rows.findIndex(row => row.id === over.id)
    if (targetIndex === -1) return
    const anchor = over.half === 'before' ? over.id : rows[targetIndex + 1]?.id
    if (anchor === activeDrag.sessionId) return
    const sourceIndex = rows.findIndex(row => row.id === activeDrag.sessionId)
    const anchorIndex = anchor === undefined ? rows.length : rows.findIndex(row => row.id === anchor)
    if (sourceIndex !== -1 && (anchorIndex === sourceIndex || anchorIndex === sourceIndex + 1)) return
    const nextOrder = rows.map(row => row.id).filter(id => id !== activeDrag.sessionId)
    const insertAt = anchor === undefined ? nextOrder.length : nextOrder.indexOf(anchor)
    nextOrder.splice(insertAt === -1 ? nextOrder.length : insertAt, 0, activeDrag.sessionId)
    setSessionOrder(FLAT_SESSION_ORDER_KEY, nextOrder.map(id => id as string))
  }
  const now = Date.now()
  return (
    <div className={clsx(css.treeBody, css.wide)}>
      <div className={clsx(css.list, css.flatList)} role="tree" aria-label={t('section.sessions')} data-pull-scroll-root=""
        onPointerDown={touchDrag.onPointerDown}
        onClickCapture={touchDrag.onClickCapture}
      >
        {rows.length === 0 && pinnedRows.length === 0 && (list.phase !== 'ready'
          ? <ListSkeleton />
          : <div className={css.empty}>{t('empty.none')}</div>)}
        {pinnedRows.length > 0 && (
          <section className={css.categorySection} aria-label={t('section.pinned')}>
            <div className={css.categoryLabel}>{t('section.pinned')}</div>
            {pinnedRows.map(node => (
              <SessionNodeItem
                key={node.id}
                node={node}
                currentId={list.current}
                now={now}
                onOpen={open}
                onRename={onSessionRename}
                onFork={forkSession}
                onMove={onMoveSessionRequest}
                onArchive={onSessionArchive}
                onInlineRename={renameSession}
                pinned
                onSetPinned={onSetSessionPinned}
                flat
                t={t}
              />
            ))}
          </section>
        )}
        {rows.length > 0 && <div className={css.categoryLabel}>{t('section.sessions')}</div>}
        {rows.map((node) => {
          const active = drag !== null
          touchDrag.registry.set(`s:${node.id as string}`, {
            id: `s:${node.id as string}`,
            start: () => {
              dropCommitted.current = false
              setDrag({ accountKey: FLAT_SESSION_ORDER_KEY, sessionId: node.id, over: null })
            },
            hover: (half) => {
              setDrag(current => current === null ? current : { ...current, over: { id: node.id, half } })
            },
            end: () => {
              if (drag?.over !== null && drag?.over !== undefined) commitDrag(drag, drag.over)
              else setDrag(null)
              dropCommitted.current = false
            },
          } satisfies TouchDragRow)
          return (
            <SessionNodeItem
              key={node.id}
              node={node}
              currentId={list.current}
              now={now}
              onOpen={open}
              onRename={onSessionRename}
              onFork={forkSession}
              onMove={onMoveSessionRequest}
              onArchive={onSessionArchive}
              onInlineRename={renameSession}
              pinned={false}
              onSetPinned={onSetSessionPinned}
              flat
              drag={{
                start: () => {
                  dropCommitted.current = false
                  setDrag({ accountKey: FLAT_SESSION_ORDER_KEY, sessionId: node.id, over: null })
                },
                active,
                marker: active && drag.over?.id === node.id ? drag.over.half : null,
                hover: (half) => {
                  setDrag(current => current === null ? current : { ...current, over: { id: node.id, half } })
                },
                drop: (half) => {
                  if (drag !== null) commitDrag(drag, { id: node.id, half })
                },
                end: () => {
                  if (drag?.over !== null && drag?.over !== undefined) commitDrag(drag, drag.over)
                  else setDrag(null)
                  dropCommitted.current = false
                },
              }}
              t={t}
            />
          )
        })}
      </div>
      <span className={css.fade} />
    </div>
  )
}

interface RemoteSearchState {
  query: string
  status: 'idle' | 'loading' | 'ready' | 'error'
  items: readonly SessionSearchResultItem[]
  hasMore: boolean
}

/** Flat search body: local metadata matches plus the current Host result page. */
function SearchResults({
  useSessions,
  open,
  workspaces,
  archivedSessionIds,
  query,
  remote,
  resultLimit,
  t,
}: Pick<SessionTreeProps, 'useSessions' | 'open' | 't'> & {
  workspaces: readonly WorkspaceView[]
  archivedSessionIds: readonly SessionNode['id'][]
  query: string
  remote: RemoteSearchState
  resultLimit: number
}) {
  const list = useSessions(s => s)
  const currentRemote = remote.query === query
    ? remote
    : { query, status: 'loading' as const, items: [], hasMore: false }
  const results = useMemo(
    () => deriveSearchResults(list, workspaces, query, archivedSessionIds, currentRemote, resultLimit),
    [list, workspaces, query, archivedSessionIds, currentRemote, resultLimit],
  )
  const pending = currentRemote.status === 'loading'
  const failed = currentRemote.status === 'error'

  return (
    <div className={clsx(css.treeBody, css.wide)}>
      <div className={css.list} data-pull-scroll-root="">
        <div className={css.searchTree} role="tree" aria-label={t('search.results.aria')}>
          {results.items.map(result => (
            <SearchResultItem
              key={result.id}
              result={result}
              currentId={list.current}
              onOpen={open}
              t={t}
            />
          ))}
        </div>
        {pending && (
          <div className={css.searchStatus} role="status">{t('search.pending')}</div>
        )}
        {failed && (
          <div className={css.searchWarning} role="status">
            {t('search.unavailable')}
          </div>
        )}
        {!pending && results.items.length === 0 && (
          <div className={css.empty}>{t('search.noMatches')}</div>
        )}
        {results.hasMore && (
          <div className={css.searchStatus}>
            {t('search.hasMore', { n: resultLimit })}
          </div>
        )}
      </div>
      <span className={css.fade} />
    </div>
  )
}

/**
 * Render the browsing region.
 * @param props - composed slot props (shell owner share + store + injected actions).
 * @returns the region element tree.
 */
export function WorkspaceBrowser({
  wide,
  expandSidebar,
  useSessions,
  useWorkspaces,
  useStore,
  actions,
  startSession,
  open,
  renameSession,
  forkSession,
  renameWorkspace,
  deleteWorkspace,
  insertWorkspaceBefore,
  archiveSession,
  unarchiveSession,
  deleteSession,
  deleteArchivedSessions,
  setSessionPinned,
  insertSessionBefore,
  createWorkspace,
  refreshAll,
  moveSession,
  updateWorkspaceSettings,
  searchSessions,
  searchResultLimit,
  useDirectoryFlow,
  useHostDescription,
  renderSlot,
  t,
}: WorkspaceBrowserProps) {
  const home = useHostDescription(description => description?.home)
  const workspaces = useWorkspaces(state => state.items)
  const workspacePhase = useWorkspaces(state => state.phase)
  const archivedSessionIds = useWorkspaces(state => state.archivedSessionIds)
  const pinnedSessionIds = useWorkspaces(state => state.pinnedSessionIds)
  // Live occupancy of this surface's directory-flow hole (the same source the
  // flow reads): a composition without a picking affordance can add nothing.
  const directoryFlowAvailable = useDirectoryFlow(occupied => occupied)
  const groupBy = useStore(s => s.groupBy)
  const orderBy = useStore(s => s.orderBy)
  // isolateActiveWorkspace removed: always show all workspaces.
  const groupExpansion = useStore(s => s.groupExpansion)
  const sessionOrderByAccount = useStore(s => s.sessionOrderByAccount)
  const sessionUpdatedAtByAccount = useStore(s => s.sessionUpdatedAtByAccount)
  const sessions = useSessions(s => s)
  const railPinnedSessions = derivePinned(sessions, pinnedSessionIds, archivedSessionIds)
  // Archive is allowed to clear the active selection. Keep a session-list
  // projection captured before that clear at the browser owner so mounting
  // the Archived view afterwards still has the authoritative summary to
  // render and restore.
  const archivedSessionCache = useRef(new Map<SessionId, SessionSummary>())
  for (const id of sessions.ids) {
    const summary = sessions.byId[id]
    if (summary !== undefined) archivedSessionCache.current.set(id, summary)
  }
  const archivedSessionList = useMemo<SessionListState>(() => ({
    ...sessions,
    ids: [...new Set([...sessions.ids, ...archivedSessionIds])],
    byId: { ...Object.fromEntries(archivedSessionCache.current), ...sessions.byId },
  }), [sessions, archivedSessionIds])
  const currentSessionId = sessions.current
  const displayWorkspaces = workspaces

  // Pull-to-refresh on touch devices: the gesture re-pulls both baselines
  // (Workspaces and Sessions) when the region is dragged down past the
  // trigger while its list sits at the top.
  const pullAreaRef = useRef<HTMLDivElement>(null)
  const pull = usePullToRefresh(pullAreaRef, refreshAll)
  const pullArmed = pull.distance >= PULL_TRIGGER_PX
  const pullLabel = pull.phase === 'refreshing'
    ? t('refresh.refreshing')
    : (pullArmed ? t('refresh.release') : t('refresh.pull'))

  const currentBlankSessionId = useSessions((state) => {
    const current = state.current
    return current !== undefined && state.byId[current]?.blank === true ? current : undefined
  })
  const currentBlankAccount = currentBlankSessionId === undefined
    ? undefined
    : (workspaces.find(workspace => workspace.sessionIds.includes(currentBlankSessionId))
      ?.workspaceId as string | undefined) ?? UNGROUPED_KEY
  const promotedBlank = useRef<{ sessionId: SessionId; accountKey: string } | undefined>(undefined)
  useEffect(() => {
    if (currentBlankSessionId === undefined || currentBlankAccount === undefined) {
      promotedBlank.current = undefined
      return
    }
    if (promotedBlank.current?.sessionId === currentBlankSessionId
      && promotedBlank.current.accountKey === currentBlankAccount) return
    promotedBlank.current = { sessionId: currentBlankSessionId, accountKey: currentBlankAccount }
    for (const accountKey of new Set([currentBlankAccount, FLAT_SESSION_ORDER_KEY])) {
      const previous = sessionOrderByAccount[accountKey] ?? []
      actions.setSessionOrder(accountKey, [
        currentBlankSessionId,
        ...previous.filter(id => id !== currentBlankSessionId),
      ])
    }
  }, [actions.setSessionOrder, currentBlankAccount, currentBlankSessionId, sessionOrderByAccount])
  useEffect(() => {
    if (workspacePhase !== 'ready') return
    actions.retainAccountKeys([
      UNGROUPED_KEY,
      FLAT_SESSION_ORDER_KEY,
      ...workspaces.map(workspace => workspace.workspaceId as string),
    ])
  }, [actions.retainAccountKeys, workspacePhase, workspaces])
  // The query outlives the tree and the input (both wide-only) so collapsing
  // does not silently drop an in-progress filter.
  const [query, setQuery] = useState('')
  const [sidebarView, setSidebarView] = useState<'all' | 'attention' | 'archived'>('all')
  const [searchExpanded, setSearchExpanded] = useState(false)
  const normalizedQuery = sanitizeSearchQuery(query).trim()
  const [remoteSearch, setRemoteSearch] = useState<RemoteSearchState>({
    query: '',
    status: 'idle',
    items: [],
    hasMore: false,
  })
  const searchRoot = useRef<HTMLDivElement | null>(null)
  const searchInput = useRef<HTMLInputElement | null>(null)
  // Section-header ＋ opens the picker menu (same popover in wide and rail
  // states; the menu anchors on this button).
  const [wsPickerOpen, setWsPickerOpen] = useState(false)
  const wsPlusRef = useRef<HTMLButtonElement>(null)
  const composingRef = useRef(false)

  // Rail search = expand + land in the search box: the flag arms before the
  // expand request; once the shell flips wide the input mounts and takes focus.
  const [searchOnExpand, setSearchOnExpand] = useState(false)
  useEffect(() => {
    if (wide && searchOnExpand) {
      const timer = window.setTimeout(() => {
        searchInput.current?.focus({ preventScroll: true })
        setSearchOnExpand(false)
      }, EXPAND_SLIDE_MS)
      return () => { window.clearTimeout(timer) }
    }
  }, [wide, searchOnExpand])

  useEffect(() => {
    if (!wide || !searchExpanded || searchOnExpand) return
    searchInput.current?.focus({ preventScroll: true })
  }, [wide, searchExpanded, searchOnExpand])

  // Outside-click dismissal stays off while the rail gesture is in flight
  // (searchOnExpand): the rail click flips the shell wide and mounts this
  // listener during its own dispatch, then keeps bubbling to document with
  // the now-unmounted rail button as its target — outside searchRoot, so the
  // listener would dismiss the search that click just opened.
  useEffect(() => {
    if (!wide || !searchExpanded || searchOnExpand) return
    const onClick = (event: MouseEvent): void => {
      if (!(event.target instanceof Node) || searchRoot.current?.contains(event.target) === true) return
      searchInput.current?.blur()
      if (normalizedQuery !== '') return
      setSearchExpanded(false)
    }
    document.addEventListener('click', onClick)
    return () => { document.removeEventListener('click', onClick) }
  }, [normalizedQuery, wide, searchExpanded, searchOnExpand])

  useEffect(() => {
    if (normalizedQuery === '') {
      setRemoteSearch({ query: '', status: 'idle', items: [], hasMore: false })
      return
    }
    const controller = new AbortController()
    setRemoteSearch({
      query: normalizedQuery,
      status: 'loading',
      items: [],
      hasMore: false,
    })
    const timer = window.setTimeout(() => {
      searchSessions(normalizedQuery, controller.signal).then((result) => {
        if (controller.signal.aborted) return
        setRemoteSearch({
          query: normalizedQuery,
          status: 'ready',
          items: result.items,
          hasMore: result.hasMore,
        })
      }).catch(() => {
        if (controller.signal.aborted) return
        setRemoteSearch({
          query: normalizedQuery,
          status: 'error',
          items: [],
          hasMore: false,
        })
      })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [normalizedQuery, searchSessions])

  // Rename dialog (browser-owned so it outlives row unmounts during collapse).
  const [renameTarget, setRenameTarget] = useState<{ workspaceId: WorkspaceId; currentTitle: string } | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)
  const renameTrimmed = renameDraft.trim()
  const renameDuplicate = renameTarget !== null && renameTrimmed !== '' && renameTrimmed !== renameTarget.currentTitle
    && workspaces.some(w => w.title === renameTrimmed)
  const renameBlocked = renaming || renameTrimmed === ''
    || renameTarget === null || renameTrimmed === renameTarget.currentTitle || renameDuplicate
  const closeRename = () => {
    if (renaming) return
    setRenameTarget(null)
    setRenameError(null)
  }
  const confirmRename = () => {
    if (renameBlocked) return
    setRenaming(true)
    setRenameError(null)
    renameWorkspace(renameTarget.workspaceId, renameTrimmed).then(() => {
      setRenaming(false)
      setRenameTarget(null)
    }).catch((reason: unknown) => {
      setRenaming(false)
      setRenameError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  // Session rename dialog (same browser-owned pattern as workspace rename;
  // sessions have no client-side name-conflict rule — the host normalizes).
  // Unlike workspace rename, an unchanged title is NOT blocked: confirming
  // the current automatic title is the gesture that pins it.
  const [sessionRenameTarget, setSessionRenameTarget] = useState<{ sessionId: SessionNode['id']; currentTitle: string } | null>(null)
  const [sessionRenameDraft, setSessionRenameDraft] = useState('')
  const [sessionRenaming, setSessionRenaming] = useState(false)
  const [sessionRenameError, setSessionRenameError] = useState<string | null>(null)
  const sessionRenameTrimmed = sessionRenameDraft.trim()
  const sessionRenameBlocked = sessionRenaming || sessionRenameTrimmed === '' || sessionRenameTarget === null
  const closeSessionRename = () => {
    if (sessionRenaming) return
    setSessionRenameTarget(null)
    setSessionRenameError(null)
  }
  const confirmSessionRename = () => {
    if (sessionRenameBlocked) return
    setSessionRenaming(true)
    setSessionRenameError(null)
    renameSession(sessionRenameTarget.sessionId, sessionRenameTrimmed).then(() => {
      setSessionRenaming(false)
      setSessionRenameTarget(null)
    }).catch((reason: unknown) => {
      setSessionRenaming(false)
      setSessionRenameError(reason instanceof Error ? reason.message : String(reason))
    })
  }
  const onSessionRename = (sessionId: SessionNode['id'], currentTitle: string) => {
    setSessionRenameTarget({ sessionId, currentTitle })
    setSessionRenameDraft(currentTitle)
    setSessionRenameError(null)
  }

  const [archiveNotifications, setArchiveNotifications] = useState<ArchiveNotification[]>([])
  const [pendingArchiveNotificationIds, setPendingArchiveNotificationIds] = useState<ReadonlySet<number>>(new Set())
  const archiveNotificationSequence = useRef(0)
  const appendArchiveNotification = (notice: ArchiveNotificationDraft) => {
    const id = archiveNotificationSequence.current + 1
    archiveNotificationSequence.current = id
    setArchiveNotifications(current => [...current.slice(-(ARCHIVE_NOTIFICATION_LIMIT - 1)), { ...notice, id }])
  }
  const replaceArchiveNotification = (id: number, notice: ArchiveNotificationDraft) => {
    setArchiveNotifications(current => current.map(currentNotice => currentNotice.id === id ? { ...notice, id } : currentNotice))
  }
  const dismissArchiveNotification = (id: number) => {
    setArchiveNotifications(current => current.filter(notice => notice.id !== id))
    setPendingArchiveNotificationIds(current => {
      if (!current.has(id)) return current
      const next = new Set(current)
      next.delete(id)
      return next
    })
  }
  const setArchiveNotificationPending = (id: number, pending: boolean) => {
    setPendingArchiveNotificationIds(current => {
      if (current.has(id) === pending) return current
      const next = new Set(current)
      if (pending) next.add(id)
      else next.delete(id)
      return next
    })
  }
  const archiveError = (reason: unknown): string => reason instanceof Error ? reason.message : String(reason)
  const retryArchive = (sessionId: SessionId, notificationId?: number) => {
    if (notificationId !== undefined) setArchiveNotificationPending(notificationId, true)
    archiveSession(sessionId).then(() => {
      if (notificationId === undefined) appendArchiveNotification({ kind: 'archived', sessionId })
      else replaceArchiveNotification(notificationId, { kind: 'archived', sessionId })
    }).catch((reason: unknown) => {
      const message = archiveError(reason)
      if (notificationId === undefined) appendArchiveNotification({ kind: 'archive-failure', sessionId, message })
      else replaceArchiveNotification(notificationId, { kind: 'archive-failure', sessionId, message })
    }).finally(() => {
      if (notificationId !== undefined) setArchiveNotificationPending(notificationId, false)
    })
  }
  // Archive retains the log and Workspace account, so the deck exposes the
  // inverse action immediately and keeps any rejected request retryable.
  const onSessionArchive = (sessionId: SessionNode['id']) => { retryArchive(sessionId) }
  const onSetSessionPinned = (sessionId: SessionNode['id'], pinned: boolean) => {
    setSessionPinned(sessionId, pinned).catch((reason: unknown) => {
      console.warn('session pin update rejected:', reason)
    })
  }
  const onSessionRestore = (sessionId: SessionId) => {
    unarchiveSession(sessionId).then(() => {
      setArchiveNotifications(current => current.filter(notice => notice.sessionId !== sessionId))
    }).catch((reason: unknown) => {
      appendArchiveNotification({ kind: 'restore-failure', sessionId, message: archiveError(reason) })
    })
  }
  const undoArchive = (notification: ArchiveNotification) => {
    setArchiveNotificationPending(notification.id, true)
    unarchiveSession(notification.sessionId).then(() => {
      dismissArchiveNotification(notification.id)
    }).catch((reason: unknown) => {
      replaceArchiveNotification(notification.id, {
        kind: 'restore-failure', sessionId: notification.sessionId, message: archiveError(reason),
      })
    }).finally(() => { setArchiveNotificationPending(notification.id, false) })
  }

  // Move session dialog
  const [moveTargetSessionId, setMoveTargetSessionId] = useState<SessionId | null>(null)
  const [moveSelectedWorkspaceId, setMoveSelectedWorkspaceId] = useState<string>('')
  const [moving, setMoving] = useState(false)
  const [moveError, setMoveError] = useState<string | null>(null)

  const onMoveSessionRequest = (sessionId: SessionNode['id']) => {
    setMoveTargetSessionId(sessionId)
    setMoveSelectedWorkspaceId(workspaces[0]?.workspaceId ?? '')
    setMoveError(null)
  }
  const closeMove = () => {
    if (moving) return
    setMoveTargetSessionId(null)
    setMoveError(null)
  }
  const confirmMove = () => {
    if (moving || moveTargetSessionId === null || moveSelectedWorkspaceId === '') return
    setMoving(true)
    setMoveError(null)
    moveSession(moveTargetSessionId, moveSelectedWorkspaceId as WorkspaceId).then(() => {
      setMoving(false)
      setMoveTargetSessionId(null)
    }).catch((reason: unknown) => {
      setMoving(false)
      setMoveError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  // Workspace project settings dialog
  const [settingsTarget, setSettingsTarget] = useState<{ workspaceId: WorkspaceId; title: string } | null>(null)
  const [selectedPreset, setSelectedPreset] = useState<string>('inherit')
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsError, setSettingsError] = useState<string | null>(null)

  const onSettingsRequest = (workspaceId: WorkspaceId, title: string) => {
    const ws = workspaces.find(w => w.workspaceId === workspaceId)
    const currentPreset = typeof ws?.settings?.permissionPreset === 'string' ? ws.settings.permissionPreset : 'inherit'
    setSettingsTarget({ workspaceId, title })
    setSelectedPreset(currentPreset)
    setSettingsError(null)
  }
  const closeSettings = () => {
    if (savingSettings) return
    setSettingsTarget(null)
    setSettingsError(null)
  }
  const confirmSettings = () => {
    if (savingSettings || settingsTarget === null) return
    setSavingSettings(true)
    setSettingsError(null)
    const ws = workspaces.find(w => w.workspaceId === settingsTarget.workspaceId)
    const newSettings: Record<string, unknown> = {
      ...ws?.settings,
      ...selectedPreset === 'inherit' ? {} : { permissionPreset: selectedPreset },
    }
    if (selectedPreset === 'inherit') {
      delete newSettings.permissionPreset
    }
    updateWorkspaceSettings(settingsTarget.workspaceId, newSettings).then(() => {
      setSavingSettings(false)
      setSettingsTarget(null)
    }).catch((reason: unknown) => {
      setSavingSettings(false)
      setSettingsError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  // Delete dialog is separate from the row so a successful removal can
  // unmount that row without tearing down the in-flight confirmation state.
  const [deleteTarget, setDeleteTarget] = useState<{ workspaceId: WorkspaceId; title: string } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteCommittedId, setDeleteCommittedId] = useState<WorkspaceId | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  useEffect(() => {
    if (deleteCommittedId === null
      || workspaces.some(workspace => workspace.workspaceId === deleteCommittedId)) return
    setDeleting(false)
    setDeleteCommittedId(null)
    setDeleteTarget(null)
  }, [deleteCommittedId, workspaces])
  const closeDelete = () => {
    if (deleting) return
    setDeleteTarget(null)
    setDeleteError(null)
  }
  const confirmDelete = () => {
    /* v8 ignore next -- the Modal is absent without a target and its button is disabled while deleting. */
    if (deleting || deleteTarget === null) return
    setDeleting(true)
    setDeleteCommittedId(null)
    setDeleteError(null)
    deleteWorkspace(deleteTarget.workspaceId).then(() => {
      // Keep the confirmation pending until this component has rendered the
      // committed list projection without the deleted id. Closing earlier
      // exposes one stale React frame to the next Create Workspace gesture.
      setDeleteCommittedId(deleteTarget.workspaceId)
    }).catch((reason: unknown) => {
      setDeleting(false)
      setDeleteError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  const [deleteSessionTarget, setDeleteSessionTarget] = useState<SessionNode | null>(null)
  const [deletingSession, setDeletingSession] = useState(false)
  const [deleteSessionError, setDeleteSessionError] = useState<string | null>(null)
  const closeDeleteSession = () => {
    if (deletingSession) return
    setDeleteSessionTarget(null)
    setDeleteSessionError(null)
  }
  const confirmDeleteSession = () => {
    if (deletingSession || deleteSessionTarget === null) return
    setDeletingSession(true)
    setDeleteSessionError(null)
    deleteSession(deleteSessionTarget.id).then(() => {
      setDeletingSession(false)
      setDeleteSessionTarget(null)
    }).catch((reason: unknown) => {
      setDeletingSession(false)
      setDeleteSessionError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  const [deleteAllArchivedOpen, setDeleteAllArchivedOpen] = useState(false)
  const [deletingAllArchived, setDeletingAllArchived] = useState(false)
  const [deleteAllArchivedError, setDeleteAllArchivedError] = useState<string | null>(null)
  const closeDeleteAllArchived = () => {
    if (deletingAllArchived) return
    setDeleteAllArchivedOpen(false)
    setDeleteAllArchivedError(null)
  }
  const confirmDeleteAllArchived = () => {
    if (deletingAllArchived) return
    setDeletingAllArchived(true)
    setDeleteAllArchivedError(null)
    deleteArchivedSessions().then(() => {
      setDeletingAllArchived(false)
      setDeleteAllArchivedOpen(false)
    }).catch((reason: unknown) => {
      setDeletingAllArchived(false)
      setDeleteAllArchivedError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  return (
    <div className={clsx(css.root, !wide && css.rail)}>
      <div className={css.sectionHeader}>
        {wide && (
          <div className={clsx(css.searchSlot, searchExpanded && css.searchSlotExpanded)}>
            <div
              ref={searchRoot}
              className={clsx(css.search, searchExpanded && css.searchExpanded)}
              onClick={() => {
                setWsPickerOpen(false)
                setSearchExpanded(true)
                searchInput.current?.focus()
              }}
            >
              <Tooltip label={t('search')} side="bottom" delayMs={500} disabled={searchExpanded}>
                <button
                  type="button"
                  className={css.searchButton}
                  aria-label={t('search.sessions.aria')}
                  aria-expanded={searchExpanded}
                  onClick={() => {
                    setWsPickerOpen(false)
                    setSearchExpanded(true)
                  }}
                >
                  <IconSearchOutline16 size={searchExpanded ? 11 : 14} />
                </button>
              </Tooltip>
              <input
                ref={searchInput}
                className={css.searchInput}
                type="text"
                placeholder={t('search.placeholder')}
                maxLength={SEARCH_QUERY_MAX_CODE_UNITS}
                value={query}
                tabIndex={searchExpanded ? 0 : -1}
                onChange={(e) => { setQuery(sanitizeSearchQuery(e.target.value)) }}
                onKeyDown={(e) => {
                  if (e.key !== 'Escape') return
                  setQuery('')
                  setSearchExpanded(false)
                }}
              />
              {searchExpanded && (
                <button
                  type="button"
                  className={css.clearButton}
                  aria-label={t('search.clear')}
                  onClick={(e) => {
                    e.stopPropagation()
                    setQuery('')
                    setSearchExpanded(false)
                  }}
                >
                  <IconCloseFill14 />
                </button>
              )}
            </div>
          </div>
        )}
        <div className={clsx(css.headerActions, wide && searchExpanded && css.headerActionsHidden)}>
          {wide && (
            <ViewOptionsMenu
              groupBy={groupBy}
              orderBy={orderBy}
              onGroupPick={(mode) => { actions.setGroupBy(mode) }}
              onOrderPick={(mode) => { actions.setOrderBy(mode) }}
              view={sidebarView}
              onViewPick={setSidebarView}
              t={t}
            />
          )}
          {/* Adding is the button's one action, so a composition with no
              picking affordance has nothing to offer here: the region hides the
              button rather than leaving a dead one in the header. */}
          {directoryFlowAvailable && (
            <Tooltip label={t('workspace.add')} side="bottom" delayMs={500}>
              <button
                ref={wsPlusRef}
                type="button"
                className={css.iconButton}
                aria-label={t('workspace.add')}
                onClick={() => {
                  setWsPickerOpen(v => !v)
                }}
              >
                <IconProjectAddOutline16 size={wide ? 16 : 18} />
              </button>
            </Tooltip>
          )}
        </div>
        {/* Add flow + its error dialog (same package — direct composition). */}
        <WorkspacePickFlow
          t={t}
          open={wsPickerOpen}
          anchorRef={wsPlusRef}
          useWorkspaces={useWorkspaces}
          createWorkspace={createWorkspace}
          useDirectoryFlow={useDirectoryFlow}
          renderDirectoryFlow={owner => renderSlot('sidebar.workspaces.directoryFlow', owner)}
          addOnly
          side="right"
          onPick={(workspaceId) => {
            setWsPickerOpen(false)
            startSession(workspaceId)
          }}
          onClose={() => { setWsPickerOpen(false) }}
        />
      </div>

      {/* The collapsed rail keeps search as its own 36px control. */}
      {!wide && <div className={css.search}>
        <Tooltip label={t('search')}>
          <button
            type="button"
            className={css.searchButton}
            aria-label={t('search.sessions.aria')}
            onClick={() => {
              setSearchExpanded(true)
              setSearchOnExpand(true)
              expandSidebar()
            }}
          >
            <IconSearchOutline16 size={18} />
          </button>
        </Tooltip>
      </div>}

      {/* Always-mounted seat keeps the region's flex slot while the list
          itself is wide-only. */}
      <div className={css.listArea} ref={pullAreaRef}>
        {wide && (
          <div
            className={css.pullIndicator}
            data-pull-phase={pull.phase}
            style={{ height: `${pull.distance}px` }}
          >
            <span
              className={clsx(css.pullIcon, pullArmed && pull.phase === 'pulling' && css.pullIconArmed)}
              aria-hidden="true"
            >
              {pull.phase === 'refreshing'
                ? <span className={css.pullSpinner} />
                : <IconChevronDownOutline14 />}
            </span>
            <span className={css.pullLabel} aria-live="polite">{pullLabel}</span>
          </div>
        )}
        {!wide && <PinnedSessionRail
          sessions={railPinnedSessions}
          currentSessionId={currentSessionId}
          open={open}
          renameSession={renameSession}
          onRenameRequest={onSessionRename}
          forkSession={forkSession}
          onMoveSessionRequest={onMoveSessionRequest}
          onSessionArchive={onSessionArchive}
          onSetSessionPinned={onSetSessionPinned}
          t={t}
        />}
        {wide && (normalizedQuery !== ''
          ? (
            <SearchResults
              useSessions={useSessions}
              open={open}
              workspaces={displayWorkspaces}
              archivedSessionIds={archivedSessionIds}
              query={normalizedQuery}
              remote={remoteSearch}
              resultLimit={searchResultLimit}
              t={t}
            />
          )
          : sidebarView === 'attention'
            ? <AttentionList useSessions={useSessions} open={open} renameSession={renameSession} onSessionRename={onSessionRename}
              forkSession={forkSession} onMoveSessionRequest={onMoveSessionRequest}
              onSessionArchive={onSessionArchive} archivedSessionIds={archivedSessionIds} t={t} />
            : sidebarView === 'archived'
              ? <ArchivedList list={archivedSessionList} archivedSessionIds={archivedSessionIds}
                open={open} renameSession={renameSession} onRestore={onSessionRestore} onDelete={(id) => {
                  const summary = archivedSessionList.byId[id]
                  setDeleteSessionTarget({
                    id,
                    title: summary?.displayTitle ?? summary?.title ?? '',
                    updatedAt: typeof summary?.updatedAt === 'number' ? summary.updatedAt : 0,
                    blank: false,
                    completed: false,
                    running: false,
                    runningSubagentCount: 0,
                  })
                }}
                onDeleteAll={() => { setDeleteAllArchivedOpen(true) }}
                t={t} />
              : groupBy === 'flat'
                ? (
                  <FlatList
                    useSessions={useSessions} open={open} renameSession={renameSession} forkSession={forkSession}
                    onSessionRename={onSessionRename} onMoveSessionRequest={onMoveSessionRequest} onSessionArchive={onSessionArchive}
                    archivedSessionIds={archivedSessionIds}
                    pinnedSessionIds={pinnedSessionIds}
                    onSetSessionPinned={onSetSessionPinned}
                    orderBy={orderBy}
                    sessionOrderByAccount={sessionOrderByAccount}
                    sessionUpdatedAtByAccount={sessionUpdatedAtByAccount}
                    syncSessionOrderAccount={actions.syncSessionOrderAccount}
                    setSessionOrder={actions.setSessionOrder}
                    t={t}
                  />
                )
                : (
                  <SessionTree
                    useSessions={useSessions}
                    renameSession={renameSession}
                    onSessionRename={onSessionRename}
                    onMoveSessionRequest={onMoveSessionRequest}
                    onSessionArchive={onSessionArchive}
                    forkSession={forkSession}
                    workspaces={displayWorkspaces}
                    groupExpansion={groupExpansion}
                    setGroupExpanded={actions.setGroupExpanded}
                    sessionOrderByAccount={sessionOrderByAccount}
                    sessionUpdatedAtByAccount={sessionUpdatedAtByAccount}
                    syncSessionOrderAccount={actions.syncSessionOrderAccount}
                    setSessionOrder={actions.setSessionOrder}
                    archivedSessionIds={archivedSessionIds}
                    pinnedSessionIds={pinnedSessionIds}
                    startSession={startSession}
                    open={open}
                    insertWorkspaceBefore={insertWorkspaceBefore}
                    insertSessionBefore={insertSessionBefore}
                    orderBy={orderBy}
                    home={home}
                    t={t}
                    onRenameRequest={(workspaceId, currentTitle) => {
                      setRenameTarget({ workspaceId, currentTitle })
                      setRenameDraft(currentTitle)
                      setRenameError(null)
                    }}
                    onSettingsRequest={onSettingsRequest}
                    onDeleteRequest={(workspaceId, title) => {
                      setDeleteTarget({ workspaceId, title })
                      setDeleteError(null)
                    }}
                    onSetSessionPinned={onSetSessionPinned}
                  />
                ))}
      </div>

      {wide && <ArchiveNotificationStack
        notifications={archiveNotifications}
        pendingIds={pendingArchiveNotificationIds}
        onDismiss={dismissArchiveNotification}
        onUndo={undoArchive}
        onRetryArchive={notification => { retryArchive(notification.sessionId, notification.id) }}
        onRetryRestore={undoArchive}
        t={t}
      />}

      <Modal
        open={renameTarget !== null}
        onClose={closeRename}
        closeLabel={t('close')}
        title={t('rename.workspace.title')}
        footer={(
          <>
            <Button variant="outline" disabled={renaming} onClick={closeRename}>{t('cancel')}</Button>
            <Button variant="primary" disabled={renameBlocked} onClick={confirmRename}>{t('rename')}</Button>
          </>
        )}
      >
        <input
          className={css.renameInput}
          value={renameDraft}
          aria-label={t('field.workspaceName')}
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
        {renameDuplicate && (
          <div className={css.renameError} role="alert">{t('conflict.named', { name: renameTrimmed })}</div>
        )}
        {renameError !== null && <div className={css.renameError} role="alert">{renameError}</div>}
      </Modal>

      <Modal
        open={sessionRenameTarget !== null}
        onClose={closeSessionRename}
        closeLabel={t('close')}
        title={t('rename.session.title')}
        footer={(
          <>
            <Button variant="outline" disabled={sessionRenaming} onClick={closeSessionRename}>{t('cancel')}</Button>
            <Button variant="primary" disabled={sessionRenameBlocked} onClick={confirmSessionRename}>{t('rename')}</Button>
          </>
        )}
      >
        <input
          className={css.renameInput}
          value={sessionRenameDraft}
          aria-label={t('field.sessionName')}
          autoFocus
          disabled={sessionRenaming}
          onFocus={(e) => { e.target.select() }}
          onChange={(e) => { setSessionRenameDraft(e.target.value); setSessionRenameError(null) }}
          onCompositionStart={() => { composingRef.current = true }}
          onCompositionEnd={() => { composingRef.current = false }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !composingRef.current) {
              e.preventDefault()
              confirmSessionRename()
            }
          }}
        />
        {sessionRenameError !== null && <div className={css.renameError} role="alert">{sessionRenameError}</div>}
      </Modal>

      <Modal
        open={moveTargetSessionId !== null}
        onClose={closeMove}
        closeLabel={t('close')}
        title={t('move.session.title')}
        footer={(
          <>
            <Button variant="outline" disabled={moving} onClick={closeMove}>{t('cancel')}</Button>
            <Button
              variant="primary"
              disabled={moving || moveSelectedWorkspaceId === ''}
              onClick={confirmMove}
            >
              {t('move.button')}
            </Button>
          </>
        )}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '240px' }}>
          <label style={{ fontSize: '13px', color: 'var(--dsw-color-text-secondary)' }}>
            {t('move.targetWorkspace')}
          </label>
          <Select
            value={moveSelectedWorkspaceId}
            onChange={(val) => { setMoveSelectedWorkspaceId(val); setMoveError(null) }}
            options={workspaces.map(w => ({ value: w.workspaceId, label: w.title }))}
            placeholder={t('move.targetWorkspace')}
          />
          {moveError !== null && <div className={css.renameError} role="alert">{moveError}</div>}
        </div>
      </Modal>

      <Modal
        open={settingsTarget !== null}
        onClose={closeSettings}
        closeLabel={t('close')}
        title={`${t('settings.workspace.title')}: ${settingsTarget?.title ?? ''}`}
        footer={(
          <>
            <Button variant="outline" disabled={savingSettings} onClick={closeSettings}>{t('cancel')}</Button>
            <Button
              variant="primary"
              disabled={savingSettings}
              onClick={confirmSettings}
            >
              {t('settings.save')}
            </Button>
          </>
        )}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', minWidth: '280px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '13px', fontWeight: 500, color: 'var(--dsw-color-text-primary)' }}>
              {t('settings.permissionPreset')}
            </label>
            <Select
              value={selectedPreset}
              onChange={(val) => { setSelectedPreset(val); setSettingsError(null) }}
              options={[
                { value: 'inherit', label: t('settings.permissionPreset.inherit') },
                { value: 'danger-full-access', label: t('settings.permissionPreset.danger') },
                { value: 'workspace-write', label: t('settings.permissionPreset.workspaceWrite') },
                { value: 'read-only', label: t('settings.permissionPreset.readOnly') },
              ]}
            />
          </div>
          {settingsError !== null && <div className={css.renameError} role="alert">{settingsError}</div>}
        </div>
      </Modal>

      <Modal
        open={deleteTarget !== null}
        onClose={closeDelete}
        closeLabel={t('close')}
        title={t('delete.workspace')}
        {...deleteTarget === null
          ? {}
          : { description: t('delete.desc', { name: deleteTarget.title }) }}
        footer={(
          <>
            <Button variant="outline" disabled={deleting} onClick={closeDelete}>{t('cancel')}</Button>
            <Button
              variant="outline"
              className={css.deleteAction}
              disabled={deleting}
              onClick={confirmDelete}
            >
              {t('delete.workspace')}
            </Button>
          </>
        )}
      >
        {deleting && <div className={css.deleteStatus} role="status">{t('delete.pending')}</div>}
        {deleteError !== null && <div className={css.renameError} role="alert">{deleteError}</div>}
      </Modal>

      <Modal
        open={deleteSessionTarget !== null}
        onClose={closeDeleteSession}
        closeLabel={t('close')}
        title={t('delete.session.title')}
        {...deleteSessionTarget === null
          ? {}
          : { description: t('delete.session.desc', { name: deleteSessionTarget.title }) }}
        footer={(
          <>
            <Button variant="outline" disabled={deletingSession} onClick={closeDeleteSession}>{t('cancel')}</Button>
            <Button
              variant="outline"
              className={css.deleteAction}
              disabled={deletingSession}
              onClick={confirmDeleteSession}
            >
              {t('delete.session.button')}
            </Button>
          </>
        )}
      >
        {deletingSession && <div className={css.deleteStatus} role="status">{t('delete.session.pending')}</div>}
        {deleteSessionError !== null && <div className={css.renameError} role="alert">{deleteSessionError}</div>}
      </Modal>

      <Modal
        open={deleteAllArchivedOpen}
        onClose={closeDeleteAllArchived}
        closeLabel={t('close')}
        title={t('delete.allArchived.title')}
        description={t('delete.allArchived.desc')}
        footer={(
          <>
            <Button variant="outline" disabled={deletingAllArchived} onClick={closeDeleteAllArchived}>{t('cancel')}</Button>
            <Button
              variant="outline"
              className={css.deleteAction}
              disabled={deletingAllArchived}
              onClick={confirmDeleteAllArchived}
            >
              {t('delete.allArchived.button')}
            </Button>
          </>
        )}
      >
        {deletingAllArchived && <div className={css.deleteStatus} role="status">{t('delete.allArchived.pending')}</div>}
        {deleteAllArchivedError !== null && <div className={css.renameError} role="alert">{deleteAllArchivedError}</div>}
      </Modal>
    </div>
  )
}
