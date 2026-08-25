/**
 * Models settings section: the provider rows joined from the configurable
 * directory, settings namespaces, and credential states, with one editor
 * card at a time. Rows expose only confirmed API-key state through accessible
 * solid configured or missing dots. A whole-section provider without a
 * configured key renders as its open setup card instead of a row, but only in
 * the first-run posture — no provider on the page can serve requests yet — and
 * only until the user closes that card; the add flow is a card carrying the
 * dormant-provider select. Each card kind owns its own open state, so closing
 * one never discards a draft in another. Every mutation writes through the
 * wire, while a provider removal first requires confirmation; the page
 * re-renders from pushed invalidations or the post-apply reload.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import { Button, IconGripOutline14, IconPlusOutline16, Modal, Select, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import { CustomProviderCard } from './CustomProviderCard.tsx'
import { deriveKeyRef, messageOf, protocolChoices, providerUsable } from './store.ts'
import type { ModelsSettingsStore, ProviderRow } from './store.ts'
import type { SettingsSchemaOperations } from './schema-operations.ts'
import { ProviderEditor, type ProviderEditorProps } from './ProviderEditor.tsx'
import { MODELS_SETTINGS_NAMESPACE, PROVIDER_ORDER_FIELD } from '../provider-order.ts'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/** Injected dependencies of {@link ModelsSection} (slot `inject`). */
export interface ModelsSectionInjected {
  /** The page store (loaded on mount, refreshed on pushed invalidations). */
  controller: ModelsSettingsStore
  hooks: {
    /** Page snapshot bound by the UI renderer as useSnapshot. */
    snapshot: ModelsSettingsStore['store']
  }
  /** Wire faces the editor writes through. */
  api: Pick<IApiClient, 'settings' | 'credentials' | 'llm'>
  /** Settings schema and immutable path callbacks. */
  schema: SettingsSchemaOperations
  /** Section copy. */
  t: (key: keyof typeof en) => string
}

/**
 * Props delivered by the slot outlet: the inject face spread flat (the
 * renderer erases the share boundary at the render call).
 */
export type ModelsSectionProps = Partial<InjectFace<ModelsSectionInjected>>

type ModelsSectionFace = InjectFace<ModelsSectionInjected>

/** Provider identity shared by row actions and confirmation copy. */
export interface ProviderIdentity {
  /** Stable provider route id. */
  provider: string
  /** Human-facing provider name. */
  displayName: string
}

/** One existing row or dormant directory entry addressed by an editor action. */
interface EditorTarget extends ProviderIdentity {
  settingsNs: string
  settingsPath: readonly string[]
  /** Page-managed credentials (the derived primary plus derived backups) removal should unset. */
  credentialRefs: readonly string[]
  /** The adapter reports this route as one it does not ship (see {@link ProviderEditorProps.declared}). */
  declared?: boolean
}

/** Values that vary around the shared provider-editor rendering. */
interface ProviderEditorRenderProps extends Pick<
  ProviderEditorProps,
  'namespace' | 'schema' | 'api' | 't' | 'readOnly' | 'onClose'
> {
  target: EditorTarget
}

/** Render an editor for either the setup posture or an expanded provider row. */
function renderProviderEditor({ target, ...props }: ProviderEditorRenderProps): ReactNode {
  return (
    <ProviderEditor
      provider={target.provider}
      displayName={target.displayName}
      settingsPath={target.settingsPath}
      {...target.declared === true ? { declared: true } : {}}
      {...props}
    />
  )
}

/**
 * Remove one user-added provider and its page-managed credentials. Credential
 * removal comes first so a second-step failure leaves the provider row visible
 * and the whole operation safely retryable; both unsets are idempotent.
 * The settings removal names the profile rather than rebuilding its whole
 * namespace from a partial view.
 * @param api - settings and credential wire faces.
 * @param controller - the page store to refresh.
 * @param target - the provider's settings address and page-managed credentials.
 * @returns the failure message, or undefined once the writes and reload landed.
 */
export async function removeProviderProfile(
  api: Pick<IApiClient, 'settings' | 'credentials'>,
  controller: ModelsSettingsStore,
  target: { settingsNs: string; settingsPath: readonly string[]; credentialRefs: readonly string[] },
): Promise<string | undefined> {
  try {
    for (const ref of target.credentialRefs) {
      const credential = await api.credentials.unset({ ref })
      if (!credential.result.ok) return credential.result.error.message
    }
    const response = await api.settings.mutate({
      ns: target.settingsNs,
      ops: [{ op: 'unset', path: [...target.settingsPath] }],
    })
    if (!response.result.ok) return response.result.error.message
  } catch (error) {
    // The transport rejected rather than answering; the caller must be able
    // to retry the idempotent operation instead of the row silently staying.
    return messageOf(error)
  }
  await controller.load()
  return undefined
}

/**
 * Whether a whole-section provider still needs its first key: an unconfigured
 * credential opens the setup card instead of showing a row. This is the
 * first-run posture alone — a user who can already reach some provider gets an
 * ordinary row with the missing-key dot, since nothing here is blocking them.
 * @param row - the joined provider row.
 * @param anyUsable - whether any joined row can already serve requests.
 * @returns whether to render the setup card.
 */
export function needsSetup(row: ProviderRow, anyUsable: boolean): boolean {
  if (anyUsable) return false
  if (row.entry.settingsPath.length > 0) return false
  return row.credential?.configured !== true
}

function targetOf(row: ProviderRow): EditorTarget {
  const managedRef = deriveKeyRef(row.entry.provider)
  const credentialRefs: string[] = []
  // The page only removes what it manages: the derived primary, and the
  // derived backup refs it wrote itself. The primary carries no suffix and
  // backups start at `_2`, matching the editor's derivation. A settings-
  // declared ref under another name is the deployment's own credential,
  // exactly like a custom apiKeyEnv.
  if (row.apiKeyEnv === managedRef
    && row.credential?.configured === true
    && row.credential.writable) {
    credentialRefs.push(managedRef)
  }
  row.backupApiKeys.forEach((ref, index) => {
    if (ref === `${managedRef}_${index + 2}`) credentialRefs.push(ref)
  })
  return {
    provider: row.entry.provider,
    displayName: row.entry.displayName,
    settingsNs: row.entry.settingsNs,
    settingsPath: row.entry.settingsPath,
    credentialRefs,
    // Absent is not "shipped": an adapter that answers nothing leaves the
    // route-level fields only a declared route owns off the card, exactly as
    // it leaves the custom tag off the row.
    ...row.entry.declared === true ? { declared: true } : {},
  }
}

/** Stable visible and accessible identity for one provider target. */
export function providerTargetLabel(target: ProviderIdentity): string {
  return target.provider === target.displayName
    ? target.provider
    : `${target.displayName} (${target.provider})`
}

/** Replace the one provider placeholder in localized destructive-action copy. */
export function providerCopy(template: string, target: ProviderIdentity): string {
  return template.replace('{provider}', () => providerTargetLabel(target))
}

/** Pointer-position half of a row card: the insert marker sits above or below. */
export function rowHalfOf(event: { clientY: number; currentTarget: HTMLElement }): 'before' | 'after' {
  const rect = event.currentTarget.getBoundingClientRect()
  return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
}

/**
 * Render the Models section content column.
 * @param props - slot-delivered injected dependencies.
 * @returns the section, or null while the shell has not injected yet.
 */
export function ModelsSection(props: ModelsSectionProps): ReactNode {
  const { controller, useSnapshot, api, schema, t } = props
  if (
    controller === undefined || useSnapshot === undefined || api === undefined
    || schema === undefined || t === undefined
  ) return null
  return <Loaded injected={{ controller, useSnapshot, api, schema, t }} />
}

function Loaded({ injected }: { injected: ModelsSectionFace }): ReactNode {
  const { controller, api, schema, t } = injected
  const state = injected.useSnapshot(snapshot => snapshot)
  const [editing, setEditing] = useState<EditorTarget | undefined>(undefined)
  const [adding, setAdding] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<EditorTarget | undefined>(undefined)
  const [deleting, setDeleting] = useState(false)
  const [deleteFailure, setDeleteFailure] = useState<string | undefined>(undefined)
  const [savedTarget, setSavedTarget] = useState<ProviderIdentity | undefined>(undefined)
  const [declaring, setDeclaring] = useState(false)
  const [dismissedSetup, setDismissedSetup] = useState<ReadonlySet<string>>(() => new Set())
  // Reorder drag: the dragged provider's route id and its row-card index, and
  // the row-card index plus pointer half the drag currently hovers (the insert
  // marker sits above or below that row). Null while no drag is in flight.
  const [drag, setDrag] = useState<{ provider: string; from: number } | null>(null)
  const [drop, setDrop] = useState<{ index: number; half: 'before' | 'after' } | null>(null)
  const [orderError, setOrderError] = useState<string | undefined>(undefined)

  const announceSaved = (target: ProviderIdentity): void => {
    // Announced only once the refreshed directory is in the snapshot the
    // notice reads its name from: an apply can rename the route, and the
    // target captured when the card opened still carries the old name.
    void controller.load().then(() => { setSavedTarget(target) })
  }

  const closeEditor = (changed: boolean, target: ProviderIdentity): void => {
    setEditing(undefined)
    setAdding(false)
    setDeclaring(false)
    if (changed) announceSaved(target)
  }

  /**
   * Close a setup card, which owns none of the state above: the row-editor,
   * add, and declare cards each own one of those, so clearing them here would
   * discard a draft the user opened beside this card. Dismissal is this card's
   * own — the provider falls back to an ordinary row for the rest of the
   * session, and reopens through Edit.
   */
  const closeSetup = (changed: boolean, target: ProviderIdentity): void => {
    setDismissedSetup(previous => new Set([...previous, target.provider]))
    if (changed) announceSaved(target)
  }

  const closeDelete = (): void => {
    if (deleting) return
    setDeleteTarget(undefined)
    setDeleteFailure(undefined)
  }

  const confirmDelete = (): void => {
    /* v8 ignore next -- the action only renders with a target and is disabled while a deletion is pending */
    if (deleteTarget === undefined || deleting) return
    setDeleting(true)
    setDeleteFailure(undefined)
    void removeProviderProfile(api, controller, deleteTarget)
      .then((failure) => {
        if (failure !== undefined) {
          setDeleteFailure(failure)
          return
        }
        setDeleteTarget(undefined)
      })
      .finally(() => { setDeleting(false) })
  }

  /** Persist the provider order and refresh the page. */
  const persistOrder = (order: string[]): void => {
    const namespace = state.namespaces.get(MODELS_SETTINGS_NAMESPACE)
    const expectedRevision = namespace?.revision
    setOrderError(undefined)
    void api.settings.update({
      ns: MODELS_SETTINGS_NAMESPACE,
      patch: { [PROVIDER_ORDER_FIELD]: order },
      ...expectedRevision === undefined ? {} : { expectedRevision },
    }).then((response) => {
      if (response.result.ok) {
        void controller.load()
      } else {
        setOrderError(response.result.error.message)
      }
    }, (error: unknown) => { setOrderError(messageOf(error)) })
  }

  /** Move one row-card provider to another index among the visible row cards. */
  const moveRow = (from: number, to: number): void => {
    setDrag(null)
    setDrop(null)
    if (to === from) return
    const moved = rowCards[from]
    /* v8 ignore next -- drag and keyboard moves always name an existing row */
    if (moved === undefined) return
    const next = rowCards.filter(row => row !== moved)
    next.splice(to, 0, moved)
    persistOrder(next.map(row => row.entry.provider))
  }

  /**
   * Commit a drop on one row card: resolve the insert anchor from the hovered
   * half (before the row, or after it = before its successor) and move the
   * dragged row there. Dropping back on the source row or a same-order
   * position writes nothing.
   * @param over - the hovered row-card index and pointer half.
   */
  const commitDrop = (over: { index: number; half: 'before' | 'after' }): void => {
    if (drag === null) return
    const moved = rowCards[drag.from]
    setDrag(null)
    setDrop(null)
    /* v8 ignore next -- the drag started on a rendered row card */
    if (moved === undefined) return
    const anchorIndex = over.half === 'before' ? over.index : over.index + 1
    const anchorRow = rowCards[anchorIndex]
    const next = rowCards.filter(row => row !== moved)
    const insertAt = anchorRow === undefined ? next.length : next.indexOf(anchorRow)
    // The anchor was the dragged row itself, so the order is unchanged.
    if (insertAt < 0) return
    next.splice(insertAt, 0, moved)
    if (next.every((row, index) => row === rowCards[index])) return
    persistOrder(next.map(row => row.entry.provider))
  }

  if (state.status === 'idle') void controller.load()
  if (state.status === 'error') {
    /* v8 ignore next -- an error status always carries text; the fallback satisfies the nullable type */
    const errorText = state.error ?? ''
    return (
      <div className={styles['section']}>
        <p className={styles['error']}>{`${t('loadFailed')}: ${errorText}`}</p>
        <button type="button" className={styles['secondaryButton']} onClick={() => { void controller.load() }}>
          {t('retry')}
        </button>
      </div>
    )
  }

  // The saved provider as the directory currently names it. The route id is
  // what the apply cannot change, so it is what the notice is keyed by; a row
  // the same apply removed keeps the captured identity, since nothing newer
  // exists to name it with.
  const savedRow = savedTarget === undefined
    ? undefined
    : state.rows.find(row => row.entry.provider === savedTarget.provider)
  const savedIdentity = savedRow === undefined
    ? savedTarget
    : { provider: savedRow.entry.provider, displayName: savedRow.entry.displayName }

  // One fact decides both first-run postures on this page and the onboarding
  // step: whether the user already has a provider to talk to.
  const anyUsable = state.rows.some(providerUsable)
  const configured = state.rows.filter(row => row.configured)
  // The reorderable list is the row cards — providers that render as rows
  // rather than first-run setup cards. A setup card shows an editor and is no
  // drag target; once dismissed or configured it joins the row list at the
  // natural end of the stored preference.
  const rowCards = configured.filter(row => !(needsSetup(row, anyUsable) && !dismissedSetup.has(row.entry.provider)))
  const rowCardIndexByProvider = new Map(rowCards.map((row, index) => [row.entry.provider, index] as const))
  const addable = state.rows.filter(row => !row.configured && row.entry.settingsNs !== '')
  const addTarget = adding ? editing : undefined
  const addNamespace = addTarget === undefined ? undefined : state.namespaces.get(addTarget.settingsNs)
  // Hand-declared routes live in the pi-ai namespace, which is also the only
  // one whose schema names the protocols one may speak; without it mounted
  // there is nothing to declare and the entry point stays disabled.
  const protocols = protocolChoices(state.namespaces.get('llm-pi-ai'), schema)

  return (
    <div className={styles['section']}>
      <h2 className={styles['title']}>{t('title')}</h2>
      <p className={styles['intro']}>{t('intro')}</p>
      {!state.writable && state.status === 'ready' ? <p className={styles['notice']}>{t('readOnly')}</p> : null}
      {savedIdentity === undefined
        ? null
        : (
          <p className={styles['savedNotice']} role="status" aria-live="polite">
            {providerCopy(t('savedProvider'), savedIdentity)}
          </p>
        )}
      {orderError === undefined ? null : <p className={styles['error']} role="alert">{orderError}</p>}
      <ul className={styles['rows']}>
        {configured.map((row) => {
          const target = targetOf(row)
          const namespace = state.namespaces.get(target.settingsNs)
          /* v8 ignore next -- the join marks a row configured only when its namespace resolved */
          if (namespace === undefined) return null
          if (needsSetup(row, anyUsable) && !dismissedSetup.has(row.entry.provider)) {
            // First-run posture: the provider exists but has no key — the
            // setup card IS its presence on the page, until the user closes it.
            return (
              <li key={row.entry.provider} className={styles['setupCard']}>
                {renderProviderEditor({
                  target,
                  namespace,
                  schema,
                  api,
                  t,
                  readOnly: !state.writable,
                  onClose: (changed) => { closeSetup(changed, target) },
                })}
              </li>
            )
          }
          const open = !adding && editing?.provider === row.entry.provider
          const credentialConfigured = row.credential?.configured === true
          const credentialMissing = !credentialConfigured
            && row.apiKeyEnv !== undefined
            && row.credential?.configured === false
          const rowIndex = rowCardIndexByProvider.get(row.entry.provider)
          /* v8 ignore next -- rowCards is the same list this branch renders */
          if (rowIndex === undefined) return null
          const dropMark = drop !== null && drop.index === rowIndex && drag?.provider !== row.entry.provider
          return (
            <li
              key={row.entry.provider}
              className={`${styles['rowCard']}${
                dropMark
                  ? drop.half === 'before'
                    ? ` ${styles['rowCardDropBefore']}`
                    : ` ${styles['rowCardDropAfter']}`
                  : ''
              }`}
              // The collapsed row drags as one card, like the sidebar session
              // rows; an open editor stays text-selectable, so only its handle
              // drags.
              draggable={!open && state.writable && rowCards.length > 1}
              onDragStart={(event) => {
                const transfer = event.dataTransfer as DataTransfer | undefined
                transfer?.setData('text/plain', row.entry.provider)
                if (transfer !== undefined) transfer.effectAllowed = 'move'
                setDrag({ provider: row.entry.provider, from: rowIndex })
              }}
              onDragEnd={() => {
                setDrag(null)
                setDrop(null)
              }}
              onDragOver={(event) => {
                if (drag === null || drag.provider === row.entry.provider) return
                event.preventDefault()
                const transfer = event.dataTransfer as DataTransfer | undefined
                if (transfer !== undefined) transfer.dropEffect = 'move'
                setDrop({ index: rowIndex, half: rowHalfOf(event) })
              }}
              onDrop={(event) => {
                if (drag === null) return
                event.preventDefault()
                commitDrop({ index: rowIndex, half: rowHalfOf(event) })
              }}
            >
              <div className={styles['rowHead']}>
                <Tooltip label={providerCopy(t('reorderProvider'), target)} side="bottom" delayMs={500}>
                  <button
                    type="button"
                    className={styles['dragHandle']}
                    aria-label={providerCopy(t('reorderProvider'), target)}
                    draggable
                    disabled={!state.writable || rowCards.length < 2}
                    onDragStart={(event) => {
                      const transfer = event.dataTransfer as DataTransfer | undefined
                      transfer?.setData('text/plain', row.entry.provider)
                      if (transfer !== undefined) transfer.effectAllowed = 'move'
                      setDrag({ provider: row.entry.provider, from: rowIndex })
                    }}
                    onDragEnd={() => {
                      setDrag(null)
                      setDrop(null)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowUp' && rowIndex > 0) {
                        event.preventDefault()
                        moveRow(rowIndex, rowIndex - 1)
                      } else if (event.key === 'ArrowDown' && rowIndex < rowCards.length - 1) {
                        event.preventDefault()
                        moveRow(rowIndex, rowIndex + 1)
                      }
                    }}
                  >
                    <IconGripOutline14 />
                  </button>
                </Tooltip>
                <span className={styles['rowIdentity']}>
                  <span className={styles['rowName']}>{row.entry.displayName}</span>
                  {/* Only the adapter can tell a hand-declared route from a
                      shipped one it also has a stored profile for, so the tag
                      follows its answer and stays off when it gives none. */}
                  {row.entry.declared === true
                    ? <span className={styles['rowTag']}>{t('customTag')}</span>
                    : null}
                  {credentialConfigured
                    ? (
                      <span
                        className={`${styles['credentialDot']} ${styles['credentialDotConfigured']}`}
                        role="img"
                        aria-label={t('credentialConfigured')}
                        title={t('credentialConfigured')}
                      />
                    )
                    : credentialMissing
                      ? (
                        <span
                          className={`${styles['credentialDot']} ${styles['credentialDotMissing']}`}
                          role="img"
                          aria-label={t('credentialMissing')}
                          title={t('credentialMissing')}
                        />
                      )
                      : null}
                </span>
                <span className={styles['rowActions']}>
                  <button
                    type="button"
                    className={styles['secondaryButton']}
                    aria-label={providerCopy(t('editProvider'), target)}
                    onClick={() => {
                      setSavedTarget(undefined)
                      // One card at a time: leaving `declaring` set would show
                      // the create card beside this editor, and closing either
                      // one discards the other's draft.
                      setDeclaring(false)
                      setAdding(false)
                      setEditing(open ? undefined : target)
                    }}
                  >
                    {t('edit')}
                  </button>
                  {row.removable
                    ? (
                      <button
                        type="button"
                        className={styles['dangerButton']}
                        aria-label={providerCopy(t('removeProvider'), target)}
                        disabled={!state.writable}
                        onClick={() => {
                          setSavedTarget(undefined)
                          setDeleteFailure(undefined)
                          setDeleteTarget(target)
                        }}
                      >
                        {t('remove')}
                      </button>
                    )
                    : null}
                </span>
              </div>
              {open
                ? renderProviderEditor({
                  target,
                  namespace,
                  schema,
                  api,
                  t,
                  readOnly: !state.writable,
                  onClose: (changed) => { closeEditor(changed, target) },
                })
                : null}
            </li>
          )
        })}
      </ul>
      <div className={styles['addBlock']}>
        {addTarget !== undefined && addNamespace !== undefined
          ? (
            <div className={styles['addCard']}>
              <div className={styles['field']}>
                <span className={styles['fieldLabel']}>{t('provider')}</span>
                <Select
                  className={styles['selectInput']}
                  value={addTarget.provider}
                  aria-label={t('provider')}
                  options={addable.map(row => ({
                    value: row.entry.provider,
                    label: row.entry.displayName,
                  }))}
                  onChange={(selectedProvider) => {
                    const row = addable.find(candidate => candidate.entry.provider === selectedProvider)
                    /* v8 ignore next -- the select only lists addable rows */
                    if (row === undefined) return
                    setEditing(targetOf(row))
                  }}
                />
              </div>
              <ProviderEditor
                key={addTarget.provider}
                provider={addTarget.provider}
                displayName={addTarget.displayName}
                hideTitle
                namespace={addNamespace}
                schema={schema}
                settingsPath={addTarget.settingsPath}
                api={api}
                t={t}
                readOnly={!state.writable}
                onClose={(changed) => { closeEditor(changed, addTarget) }}
              />
            </div>
          )
          : declaring
            ? (
              <div className={styles['addCard']}>
                <CustomProviderCard
                  taken={state.rows.map(row => row.entry.provider)}
                  protocols={protocols}
                  /* v8 ignore next -- the card only opens from a button disabled without this namespace */
                  revision={state.namespaces.get('llm-pi-ai')?.revision ?? 0}
                  api={api}
                  t={t}
                  readOnly={!state.writable}
                  onClose={(changed) => {
                    setDeclaring(false)
                    if (changed) void controller.load()
                  }}
                />
              </div>
            )
            : (
              // One row for the two ways to gain a provider: adopt one the
              // adapter already knows, or declare one it does not. Side by side
              // and equal-width so they read as siblings and line up with the
              // rows above, rather than two pills of different lengths.
              <div className={styles['addActions']}>
                <button
                  type="button"
                  className={styles['addButton']}
                  disabled={addable.length === 0 || !state.writable}
                  onClick={() => {
                    const first = addable[0]
                    /* v8 ignore next -- the button is disabled while nothing is addable */
                    if (first === undefined) return
                    setSavedTarget(undefined)
                    setDeclaring(false)
                    setAdding(true)
                    setEditing(targetOf(first))
                  }}
                >
                  {/* Same glyph as the composer's attach button. */}
                  <IconPlusOutline16 size={14} />
                  {t('add')}
                </button>
                <button
                  type="button"
                  className={styles['addButton']}
                  disabled={protocols.length === 0 || !state.writable}
                  onClick={() => {
                    setSavedTarget(undefined)
                    setAdding(false)
                    setEditing(undefined)
                    setDeclaring(true)
                  }}
                >
                  <IconPlusOutline16 size={14} />
                  {t('customAdd')}
                </button>
              </div>
            )}
      </div>
      <Modal
        open={deleteTarget !== undefined}
        onClose={closeDelete}
        title={deleteTarget === undefined ? '' : providerCopy(t('deleteTitle'), deleteTarget)}
        closeLabel={t('close')}
        description={deleteTarget === undefined
          ? ''
          : providerCopy(
            deleteTarget.credentialRefs.length === 0
              ? t('deleteDescription')
              : t('deleteDescriptionWithCredential'),
            deleteTarget,
          )}
        className={styles['deleteDialog'] as string}
        footer={(
          <>
            <Button variant="outline" autoFocus disabled={deleting} onClick={closeDelete}>
              {t('cancel')}
            </Button>
            <Button
              variant="outline"
              className={styles['deleteConfirm']}
              disabled={deleting}
              onClick={confirmDelete}
            >
              {deleteTarget === undefined
                ? ''
                : providerCopy(deleting ? t('deleting') : t('deleteConfirm'), deleteTarget)}
            </Button>
          </>
        )}
      >
        {deleteFailure === undefined ? null : <p className={styles['error']}>{deleteFailure}</p>}
      </Modal>
    </div>
  )
}
