/**
 * Workspace pick/add flow. WorkspacePickFlow is the reusable core (menu +
 * path error dialog) consumed directly by WorkspaceBrowser (same package) and
 * wrapped by WorkspacePicker for the conversation empty-state slot
 * registration. Directory picking itself lives in the composed flow package's
 * slot occupant (see the contract module doc): this core only opens the flow,
 * adopts the picked path, and owns the error surface. Adding a workspace has
 * exactly one route — pick a host directory, new or existing — because the
 * occupant's own create-folder affordance already covers creating one.
 */
import type { ReactNode, RefObject } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Button, IconFolderClose16, IconNewChatOutline16, IconPlusOutline16, Menu, Modal, type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  WorkspaceId, WorkspaceListState, WorkspaceView,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { DirectoryFlowOwnerProps, WorkspacePickerProps } from './contract/slots.ts'
import css from './WorkspacePicker.module.css'

const ADD_WORKSPACE = '::add-workspace'
const NO_WORKSPACE = '::no-workspace'

/** Core flow props: the owner supplies popover control and pick semantics. */
export interface WorkspacePickFlowProps {
  /** The standard locale seat, forwarded by whichever slot entry hosts the flow. */
  t: WorkspacePickerProps['t']
  /** Popover visibility (anchor button toggle state, owner-local). */
  open: boolean
  /** The anchor button element — the popover's placement anchor. */
  anchorRef?: RefObject<HTMLElement | null> | undefined
  /** Selector hook over the workspace list (framework standard hook). */
  useWorkspaces: <S>(selector: (state: WorkspaceListState) => S) => S
  /** Adopt a picked host directory as a real Workspace. */
  createWorkspace: (input: { path: string }) => Promise<WorkspaceView>
  /** Bound occupancy selector hook for this surface's directory-flow hole (empty leaves the surface with no add action). */
  useDirectoryFlow: SnapshotSelectorHook<boolean>
  /** Render this surface's directory-flow hole with the owner conversation (the entry's narrowed renderSlot). */
  renderDirectoryFlow: (owner: DirectoryFlowOwnerProps) => ReactNode
  /** A real Workspace was picked, or undefined when standalone / no workspace was chosen. */
  onPick: (workspaceId: WorkspaceId | undefined) => void
  /** Close the popover (outside click / Escape / post-pick). */
  onClose: () => void
  /** End an external picker request without choosing a Workspace. */
  onCancel?: (() => void) | undefined
  /** Only offer the add action, hide existing workspaces. */
  addOnly?: boolean | undefined
  /** Bypass the menu and start the composed directory flow for an external request. */
  directDirectoryFlow?: boolean | undefined
  /** Menu opening direction relative to the anchor. */
  side?: ('bottom' | 'top' | 'right') | undefined
  /** Currently active workspace (trailing check in the picker list). */
  selectedId?: WorkspaceId | undefined
  /**
   * The surface currently shows the standalone no-Workspace state, so the
   * menu marks the no-Workspace entry selected. Absent on a cold start,
   * where nothing is chosen yet and no entry may read as selected.
   */
  standalone?: boolean | undefined
}

/**
 * Render the pick menu plus the adoption error dialog.
 * @param props - owner-controlled flow props.
 * @returns menu + dialog elements.
 */
export function WorkspacePickFlow({
  t,
  open,
  anchorRef,
  useWorkspaces,
  createWorkspace,
  useDirectoryFlow,
  renderDirectoryFlow,
  onPick,
  onClose,
  onCancel,
  addOnly = false,
  directDirectoryFlow = false,
  side = 'bottom',
  selectedId,
  standalone = false,
}: WorkspacePickFlowProps) {
  const workspaceSnapshot = useWorkspaces(state => state)
  const workspaces = workspaceSnapshot.items
  const getAnchorRect = useCallback(
    () => anchorRef?.current?.getBoundingClientRect() ?? null,
    [anchorRef],
  )
  const [errorOpen, setErrorOpen] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)
  const [flowOpen, setFlowOpen] = useState(false)
  const [pickingFolder, setPickingFolder] = useState(false)
  // One picking interaction at a time: while the flow is open (native chooser
  // pending, browse dialog up) or its pick is being adopted, every other
  // menu action stays disabled — a late outcome must not race a concurrent
  // selection or adoption.
  const flowBusy = flowOpen || pickingFolder

  // The occupied hole gates the picking affordance: with no composed flow the
  // entry simply is not there (the seam's documented no-flow default). The
  // framework-bound hook keeps occupancy live: flow plugins activate (and
  // HMR-reload) independently of this menu's renders.
  const flowAvailable = useDirectoryFlow(occupied => occupied)
  // An occupant that unloads mid-interaction leaves nobody to cancel: an
  // open flow over an empty hole withdraws so the menu actions come back.
  // flowOpen is a dependency because the flow can also OPEN over an already
  // empty hole (Choose again after the occupant unloaded with the error
  // dialog up) — that transition must snap back too, not just occupancy loss.
  useEffect(() => {
    if (flowOpen && !flowAvailable) setFlowOpen(false)
  }, [flowOpen, flowAvailable])
  const addEntries: MenuEntry[] = flowAvailable
    ? [{ id: ADD_WORKSPACE, label: t('menu.addWorkspace'), icon: <IconPlusOutline16 size={16} />, disabled: flowBusy }]
    : []
  const noWorkspaceEntry: MenuEntry = {
    id: NO_WORKSPACE,
    label: t('menu.noWorkspace'),
    icon: <IconNewChatOutline16 size={16} />,
    disabled: flowBusy,
  }
  const items: MenuEntry[] = addOnly
    ? addEntries
    : workspaces.length === 0 && !flowAvailable
      ? []
      : [
        noWorkspaceEntry,
        ...(workspaces.length > 0
          ? [
            { type: 'separator', id: 'sep-workspaces' } as const,
            ...workspaces.map(workspace => ({
              id: workspace.workspaceId,
              label: workspace.title,
              icon: <IconFolderClose16 size={16} />,
              disabled: flowBusy,
            })),
          ]
          : []),
      ]
  // Nothing listed and nothing to add with (a composition that mounts this
  // package without any directory-picker): an empty popover would claim a
  // choice that does not exist, so the anchor gesture shows nothing at all.
  const menuIsEmpty = items.length === 0

  const closeModal = (): void => {
    setErrorOpen(false)
    setModalError(null)
    if (directDirectoryFlow) onCancel?.()
  }

  /** Adopt a picked directory; failures land in the folder-error dialog (Choose again reopens the flow). */
  const adoptDirectory = (path: string): Promise<void> =>
    createWorkspace({ path }).then((workspace) => {
      setFlowOpen(false)
      onPick(workspace.workspaceId)
    }).catch((reason: unknown) => {
      setModalError(reason instanceof Error ? reason.message : String(reason))
      setFlowOpen(false)
      setErrorOpen(true)
    })

  const openDirectoryFlow = useCallback((): void => {
    onClose()
    setErrorOpen(false)
    setModalError(null)
    setFlowOpen(true)
  }, [onClose])

  // An add-only control has no selection decision, so its anchor gesture is
  // the add action itself. The ordinary picker always keeps its menu: even an
  // empty Workspace list still offers the independent no-Workspace choice and
  // the Add workspace footer. External requests bypass that menu separately.
  const addIsTheOnlyEntry = addOnly && addEntries.length === 1
  const opensDirectoryFlowDirectly = addIsTheOnlyEntry || directDirectoryFlow
  // `flowBusy` gates this exactly as it disables the equivalent menu entry: a
  // pick still being adopted owns the surface until it settles.
  useEffect(() => {
    if (open && opensDirectoryFlowDirectly && !flowBusy && !errorOpen) openDirectoryFlow()
  }, [open, opensDirectoryFlowDirectly, flowBusy, errorOpen, openDirectoryFlow])

  /** Owner side of the flow conversation: adopt keeps the flow open (busy) until the Host answers. */
  const flowOwner: DirectoryFlowOwnerProps = {
    open: flowOpen,
    busy: pickingFolder,
    onPicked: (path) => {
      setPickingFolder(true)
      void adoptDirectory(path).finally(() => { setPickingFolder(false) })
    },
    onCancel: () => {
      setFlowOpen(false)
      onCancel?.()
    },
    onError: (message) => {
      setFlowOpen(false)
      setModalError(message)
      setErrorOpen(true)
    },
  }

  const handleSelect = (id: string): void => {
    if (id === ADD_WORKSPACE) {
      openDirectoryFlow()
      return
    }
    if (id === NO_WORKSPACE) {
      onPick(undefined)
      return
    }
    onPick(id as WorkspaceId)
  }

  return (
    <>
      <Menu
        open={open && !opensDirectoryFlowDirectly && !menuIsEmpty}
        anchor={null}
        items={items}
        {...!addOnly && addEntries.length > 0 ? { footer: addEntries } : {}}
        // The no-Workspace check names a state the user reached (a standalone
        // session); on a cold start the "Choose workspace" placeholder means
        // nothing is chosen, so no entry may read as selected.
        selectedId={selectedId ?? (!addOnly && standalone ? NO_WORKSPACE : undefined)}
        onSelect={handleSelect}
        onClose={onCancel ?? onClose}
        side={side}
        portal
        getAnchorRect={getAnchorRect}
      />
      {open && !opensDirectoryFlowDirectly && !menuIsEmpty && workspaceSnapshot.phase === 'pending' && <div className={css.menuStatus} role="status">{t('picker.loading')}</div>}
      {renderDirectoryFlow(flowOwner)}
      <Modal
        open={errorOpen}
        onClose={closeModal}
        closeLabel={t('close')}
        title={t('folderError.title')}
        footer={(
          <>
            <Button variant="outline" className={css.modalAction} onClick={closeModal}>{t('cancel')}</Button>
            {/* Retrying needs an occupant to serve the flow; without one the
              * button would open a flow nobody can answer or cancel. */}
            <Button variant="primary" className={css.modalAction} disabled={!flowAvailable} onClick={openDirectoryFlow}>{t('folderError.retry')}</Button>
          </>
        )}
      >
        <div className={css.modalError} role="alert">{modalError}</div>
      </Modal>
    </>
  )
}

/**
 * The conversation empty-state registration: adapts the owner share to the
 * core flow (all state and semantics live in the flow / the owner).
 * @param props - empty-state slot props (owner share + injected creation callback).
 * @returns the flow element.
 */
export function WorkspacePicker({
  open,
  anchorRef,
  useWorkspaces,
  selectedId,
  standalone,
  onPick,
  onClose,
  createWorkspace,
  useDirectoryFlow,
  useWorkspacePickerRequest,
  settleWorkspacePickerRequest,
  renderSlot,
  t,
}: WorkspacePickerProps) {
  const request = useWorkspacePickerRequest(revision => revision)
  // The onboarding handoff can happen before this slot renders: start at the
  // service's zero revision so a request already published during mount still
  // opens the existing picker.
  const observedRequest = useRef(0)
  const [requestedOpen, setRequestedOpen] = useState(false)
  const directoryFlowAvailable = useDirectoryFlow(occupied => occupied)

  useEffect(() => {
    if (request === observedRequest.current) return
    observedRequest.current = request
    setRequestedOpen(true)
  }, [request])

  const close = useCallback((): void => {
    onClose()
  }, [onClose])
  const cancelRequest = useCallback((): void => {
    setRequestedOpen(false)
    settleWorkspacePickerRequest(false)
    onClose()
  }, [onClose, settleWorkspacePickerRequest])
  const pickWorkspace = useCallback((workspaceId: WorkspaceId | undefined): void => {
    setRequestedOpen(false)
    settleWorkspacePickerRequest(true)
    onPick(workspaceId)
  }, [onPick, settleWorkspacePickerRequest])

  // The request channel only accepts a live occupant, but it can unload after
  // acceptance and before this picker observes its revision. Settle that
  // handoff as cancelled instead of opening an ownerless direct flow.
  useEffect(() => {
    if (requestedOpen && !directoryFlowAvailable) cancelRequest()
  }, [cancelRequest, directoryFlowAvailable, requestedOpen])

  return (
    <WorkspacePickFlow
      t={t}
      open={open || requestedOpen}
      anchorRef={anchorRef}
      useWorkspaces={useWorkspaces}
      createWorkspace={createWorkspace}
      useDirectoryFlow={useDirectoryFlow}
      renderDirectoryFlow={owner => renderSlot('conversation.hero.workspace.directoryFlow', owner)}
      directDirectoryFlow={requestedOpen}
      selectedId={selectedId}
      standalone={standalone}
      onPick={pickWorkspace}
      onClose={close}
      onCancel={cancelRequest}
    />
  )
}
