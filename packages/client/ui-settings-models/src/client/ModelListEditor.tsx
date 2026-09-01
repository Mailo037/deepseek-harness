/**
 * The model list of one pi-ai provider profile, plus the action that asks the
 * provider what it serves.
 *
 * The list is the profile's `models` array as the card holds it: an empty list
 * means "serve this route's built-in catalog", and any entry replaces that
 * catalog, so a row is only ever added deliberately. Fetching asks the endpoint
 * **the form currently shows** — including a key typed but not yet saved — so
 * adding a provider is one pass instead of save-then-return; the reply is
 * candidates the user picks from, never configuration written behind them.
 *
 * A provider that cannot be interrogated (an unreachable endpoint, a protocol
 * with no readable listing) is not a dead end: the failure is shown next to the
 * rows the user can still fill in by hand.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { DiscoveredModelView, IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import {
  Button, IconEditOutline16, IconGripOutline14, Modal, MultiSelect,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { formatCapacity, parseCapacity } from './DeepSeekModelsEditor.tsx'
import type { DeepSeekModelDraft } from './DeepSeekModelsEditor.tsx'
import { ModelModalityDialog, ModalityBadges } from './ModelModalityDialog.tsx'
import { messageOf } from './store.ts'
import {
  indexAfterMove, indexAfterRemove, insertIndexOf, movedRows, reindexRowState, rekeyEditingBuffers,
  rowHalfOf, type RowHalf,
} from './reorder.ts'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/** Determine selected reasoning effort keys array for a model draft. */
function reasoningValuesOf(model: ModelDraft, defaultEfforts: readonly string[] = []): readonly string[] {
  const value = model['reasoningEfforts']
  if (value === false) return []
  if (typeof value === 'object' && value !== null) {
    return Object.keys(value).filter(k => (value as Record<string, unknown>)[k] !== null || k === 'off')
  }
  if (value === undefined) {
    return defaultEfforts
  }
  return []
}

/**
 * One configured model row. Structurally open, exactly like the DeepSeek
 * catalog editor's rows: a profile field this card does not edit — one a future
 * schema adds, or one hand-written in `settings.yaml` — has to survive being
 * edited here rather than being dropped by a rebuild.
 */
export type ModelDraft = DeepSeekModelDraft

/**
 * The catalog-match candidates for one entered model id, least aggressive
 * first. A deployment may label a real catalog model with a route or brand
 * prefix (a `/`-separated path, or a leading `-` token such as `stealth-`), so
 * the id is tried as itself and then in progressively trimmed forms:
 * - the last `/`-segment of a path prefix is kept (`gpt/ox-alpha` → `ox-alpha`);
 * - leading `-` tokens are stripped one at a time (`stealth-ox-alpha` →
 *   `ox-alpha`, then `alpha`).
 * `stealth-ox-alpha` thus resolves to a catalog `ox-alpha` instead of reading
 * as an unknown, hand-declared model.
 * @param id - the id as typed.
 * @returns the unique candidate forms, most specific first.
 */
export function catalogCandidates(id: string): string[] {
  const trimmed = id.trim()
  if (trimmed.length === 0) return []
  const candidates: string[] = []
  const seen = new Set<string>()
  const push = (candidate: string): void => {
    if (candidate.length === 0 || seen.has(candidate)) return
    seen.add(candidate)
    candidates.push(candidate)
  }
  // The id exactly as typed is always the first candidate. When it is a
  // `/`-separated path, the last segment (the model) is the base for the
  // remaining dash trimming; otherwise the whole id is. Leading `-` tokens are
  // then dropped one at a time on that base, so intermediate path prefixes are
  // never standalone candidates.
  push(trimmed)
  const segments = trimmed.split('/')
  const modelBase = segments.at(-1) ?? trimmed
  const dashStart = segments.length > 1 ? 0 : 1
  const dashes = modelBase.split('-')
  for (let drop = dashStart; drop < dashes.length; drop++) {
    push(dashes.slice(drop).join('-'))
  }
  return candidates
}

/**
 * The catalog entry an entered model id denotes, allowing a routing prefix.
 * {@link catalogCandidates} trims the id into progressively looser forms, and
 * the first one the catalog knows names the model. The id as stored is never
 * rewritten — this only decides whether the row inherits catalog settings.
 * @param modelId - the id as typed.
 * @param catalog - the provider's known catalog ids to their information.
 * @returns the matching catalog entry, or `undefined` when nothing matches.
 */
function catalogOf(modelId: string, catalog: ReadonlyMap<string, CatalogModelInfo>): CatalogModelInfo | undefined {
  for (const candidate of catalogCandidates(modelId)) {
    const info = catalog.get(candidate)
    if (info !== undefined) return info
  }
  return undefined
}

/** A row's text field, or the empty string when unset or not a string. */
function textOf(model: ModelDraft, key: string): string {
  const value = model[key]
  return typeof value === 'string' ? value : ''
}

/** A row's numeric field, or `undefined` when unset or not a number. */
function numberOf(model: ModelDraft, key: string): number | undefined {
  const value = model[key]
  return typeof value === 'number' ? value : undefined
}

/** What an interrogation needs, taken from the live form. */
export interface ProbeTarget {
  /** Settings namespace whose adapter family answers. */
  settingsNs: string
  /**
   * Route being edited, when the card edits one. An adapter that already
   * describes it answers from its own registry, so such a card can ask without
   * an endpoint at all.
   */
  provider?: string
  /** Endpoint as the form currently shows it. */
  baseURL?: string
  /** Wire protocol the form names, when it names one. */
  api?: string
  /** Key typed into the form and not yet stored, when there is one. */
  apiKey?: string
}

/** Props of {@link ModelListEditor}. */
export interface ModelListEditorProps {
  /** The rows as currently drafted. */
  models: readonly ModelDraft[]
  /** Whether the user layer currently owns the whole array; absent on a create. */
  overridden?: boolean
  /** Replace the drafted rows. */
  onChange: (models: ModelDraft[]) => void
  /** Remove the user-owned array and return to inheritance; absent on a create. */
  onReset?: () => void
  /** Endpoint facts for the fetch action. */
  probe: ProbeTarget
  /**
   * Copy key naming why the fetch action is unavailable, or `undefined` when
   * it is. The card owns this because the key it would send is judged there:
   * asking with a key the form has already refused spends a round trip to be
   * told what the field already says.
   */
  probeBlocked?: keyof typeof en | undefined
  /** Wire face the fetch action calls. */
  api: Pick<IApiClient, 'llm'>
  /** Section copy. */
  t: (key: keyof typeof en) => string
  /** Disable every control (read-only deployment or a pending write). */
  disabled: boolean
}

/** Disclosure chevron; rotates to point down while its row is open. */
function IconChevron({ open }: { open: boolean }): ReactNode {
  return (
    <svg
      width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden
      style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform 120ms ease' }}
    >
      <path d="M6 3.5L10.5 8L6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Removal glyph for one model row. */
function IconTrash(): ReactNode {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9a1 1 0 001 .9h4.6a1 1 0 001-.9L12 4M6.5 6.8v4.4M9.5 6.8v4.4"
        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  )
}

/** The two token counts edited as K/M-suffixed text behind a row's disclosure. */
type CapacityField = 'contextWindow' | 'maxTokens'

/**
 * What an empty capacity field is worth, shown as its placeholder so a row left
 * blank does not read as a model with no capacity at all.
 *
 * The magnitudes are the adapter's own route-level fallbacks (`llm-pi-ai`'s
 * `defaultContextWindow` and `defaultMaxTokens`), spelled the way a person
 * would say them. They are a hint, not a mirror: this page counts `K` as 1000,
 * so typing `256K` stores 256000 while leaving the field blank keeps the
 * adapter's 262144. A deployment that overrides those defaults is not
 * reflected here — nothing on this page can read them.
 */
const CAPACITY_HINT: Readonly<Record<CapacityField, string>> = {
  contextWindow: '256K',
  maxTokens: '32K',
}

/** The modalities the pi-ai adapter accepts, mirroring its MODALITIES. */
const PI_AI_MODALITIES: readonly string[] = ['text', 'image']

/**
 * Spell a stored count for a field that may be unset. The spelling itself is
 * {@link formatCapacity}, shared with the DeepSeek catalog editor so both
 * surfaces read and write one K/M vocabulary.
 * @param value - stored capacity, or `undefined` for an unset field.
 * @returns the field text, empty when unset.
 */
function capacitySpelling(value: number | undefined): string {
  return value === undefined ? '' : formatCapacity(value)
}

/** Adopt a candidate, keeping whatever capacities the provider disclosed. */
function adopt(candidate: DiscoveredModelView): ModelDraft {
  return {
    id: candidate.id,
    ...candidate.name === undefined ? {} : { name: candidate.name },
    ...candidate.contextWindow === undefined ? {} : { contextWindow: candidate.contextWindow },
    ...candidate.maxTokens === undefined ? {} : { maxTokens: candidate.maxTokens },
  }
}

/**
 * Render the model list with its fetch action.
 * @param props - the drafted rows, probe target, wire face, and copy.
 * @returns the model-list editor.
 */
interface CatalogModelInfo {
  supportsReasoning: boolean
  defaultEfforts: string[]
  inputModalities: string[]
  visionInferred?: boolean
}

export function ModelListEditor(props: ModelListEditorProps): ReactNode {
  const { models, onChange, probe, api, t, disabled } = props
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [candidates, setCandidates] = useState<readonly DiscoveredModelView[] | undefined>(undefined)
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [catalogMap, setCatalogMap] = useState<ReadonlyMap<string, CatalogModelInfo>>(new Map())

  useEffect(() => {
    let active = true
    api.llm.models({}).then((response) => {
      if (!active || !response.result.ok) return
      const map = new Map<string, CatalogModelInfo>()
      const group = response.result.value.groups.find(g => g.id === probe.provider)
      if (group) {
        for (const m of group.models) {
          const supportsReasoning = m.reasoning !== undefined
          const defaultEfforts = m.reasoning?.efforts.map(e => e.id) ?? []
          const rawModalities = m.inputModalities
          const inputModalities = rawModalities ?? (
            m.id.includes('gemini') || m.id.includes('qwen-vl') || m.id.includes('glm-4v')
              ? ['text', 'image', 'video']
              : m.id.includes('image') || m.id.includes('vision') || m.id.includes('envision') || m.id.includes('vl') || m.id.includes('janus') || m.id.includes('4o') || m.id.includes('sonnet') || m.id.includes('opus') || m.id.includes('o1') || m.id.includes('o3') || m.id.includes('pixtral') || m.id.includes('llava')
                ? ['text', 'image']
                : ['text']
          )
          const visionInferred = (m as { visionInferred?: boolean }).visionInferred ?? (rawModalities === undefined && inputModalities.includes('image'))
          map.set(m.id, {
            supportsReasoning,
            defaultEfforts,
            inputModalities,
            visionInferred,
          })
        }
      }
      setCatalogMap(map)
    }).catch(() => {})
    return () => { active = false }
  }, [api.llm, probe.provider])
  // Rows carry an id and a name; capacities are the exception, so they stay
  // folded until asked for rather than crowding every row with four inputs.
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set())
  // Capacities are edited as text, so a field's keystrokes are held here rather
  // than re-derived from the parsed count on every change — that would rewrite
  // `1000` to `1K` mid-word. Unreadable text is kept past blur so the refusal
  // names a row the user can still see, which is why this is one entry PER
  // FIELD: a single buffer would be displaced by editing any other field, and
  // the abandoned one would render its stored NaN as the literal `NaN`.
  const [editing, setEditing] = useState<ReadonlyMap<string, string>>(new Map())
  // The open modality-override dialog targets one row index; undefined while closed.
  const [modalityTarget, setModalityTarget] = useState<number | undefined>(undefined)
  // Drag reorder: the dragged row while a drag runs, and the hovered row half
  // that positions the insert marker — the same pair the provider list keeps.
  const [drag, setDrag] = useState<{ from: number } | null>(null)
  const [drop, setDrop] = useState<{ index: number; half: RowHalf } | null>(null)

  /** Buffer key for one capacity field; the row half moves when rows do. */
  const bufferKey = (index: number, field: CapacityField): string => `${String(index)}:${field}`

  const editCapacity = (index: number, field: CapacityField, text: string): void => {
    setEditing(current => new Map(current).set(bufferKey(index, field), text))
    patch(index, { [field]: parseCapacity(text) })
  }

  /** What a capacity field shows: the buffer while typing, else the stored count. */
  const capacityText = (model: ModelDraft, index: number, field: CapacityField): string =>
    editing.get(bufferKey(index, field)) ?? capacitySpelling(numberOf(model, field))

  const remove = (index: number): void => {
    const shifted = (at: number): number | undefined => indexAfterRemove(at, index)
    // Both stores are keyed by position, so every row after this one shifts
    // down and would otherwise inherit its neighbour's state — a different
    // row's capacities popping open, or its half-typed text appearing in
    // another row's field.
    setEditing(current => rekeyEditingBuffers(current, shifted))
    setExpanded(current => reindexRowState(current, shifted))
    setModalityTarget(current => (current === undefined ? undefined : shifted(current)))
    onChange(models.filter((_model, at) => at !== index))
  }

  const move = (from: number, to: number): void => {
    setDrag(null)
    setDrop(null)
    if (to === from) return
    /* v8 ignore next -- drag and keyboard moves always name an existing row */
    if (models[from] === undefined) return
    const shifted = (at: number): number => indexAfterMove(at, from, to)
    setEditing(current => rekeyEditingBuffers(current, shifted))
    setExpanded(current => reindexRowState(current, shifted))
    setModalityTarget(current => (current === undefined ? undefined : shifted(current)))
    onChange(movedRows(models, from, to))
  }

  const commitDrop = (over: { index: number; half: RowHalf }): void => {
    if (drag === null) return
    move(drag.from, insertIndexOf(drag.from, over))
  }

  /** The modalities a row answers with: its override, else the catalog entry, else text. */
  const effectiveInputOf = (model: ModelDraft): readonly string[] => {
    const stored = model['input']
    const own = Array.isArray(stored)
      ? stored.filter((value): value is string =>
        typeof value === 'string' && PI_AI_MODALITIES.includes(value))
      : []
    if (own.length > 0) return own
    // Absent and empty both inherit: the catalog entry, or the adapter default
    // for an id the catalog does not know.
    const id = textOf(model, 'id')
    const info = id !== '' ? catalogOf(id, catalogMap) : undefined
    return info?.inputModalities ?? ['text']
  }

  /** Insert-marker class for a hovered entry, absent while it is the dragged one. */
  const dropMarkClass = (index: number): string => {
    if (drop === null || drop.index !== index) return ''
    // Reaches only if state ever desyncs: the hover guard never parks a marker
    // on the dragged row itself.
    /* v8 ignore next -- the hover guard never parks a marker on the dragged row */
    if (drag?.from === index) return ''
    return drop.half === 'before' ? ` ${styles['modelEntryDropBefore']}` : ` ${styles['modelEntryDropAfter']}`
  }

  /** The open dialog for one row, gone when a move or remove has dropped the row. */
  const modalityDialogFor = (target: number): ReactNode => {
    const model = models[target]
    /* v8 ignore next -- move and remove re-map the open dialog onto its row */
    if (model === undefined) return null
    return (
      <ModelModalityDialog
        choices={PI_AI_MODALITIES}
        selected={effectiveInputOf(model)}
        allowEmpty
        t={t}
        onApply={(next) => {
          // An empty selection is the inherit path: the field drops and the
          // row reads the catalog entry again.
          patch(target, { input: next.length === 0 ? undefined : [...next] })
          setModalityTarget(undefined)
        }}
        onClose={() => { setModalityTarget(undefined) }}
      />
    )
  }

  const toggleExpanded = (index: number): void => {
    setExpanded((current) => {
      const next = new Set(current)
      if (!next.delete(index)) next.add(index)
      return next
    })
  }

  const patch = (index: number, next: Record<string, unknown>): void => {
    onChange(models.map((model, at) => {
      if (at !== index) return model
      // Rebuilt rather than spread over: an emptied optional field has to leave
      // the profile, not be stored as a value its schema would reject.
      // Spread first so a field this card does not edit survives; an emptied
      // optional field is then dropped rather than stored as a value its
      // schema would reject.
      const cleared = new Set(
        Object.entries(next).filter(([, value]) => value === undefined || value === '').map(([key]) => key),
      )
      return Object.fromEntries(
        Object.entries({ ...model, ...next }).filter(([key]) => !cleared.has(key)),
      )
    }))
  }

  const fetchModels = async (): Promise<void> => {
    setBusy(true)
    setFailure(undefined)
    try {
      const response = await api.llm.discoverModels({
        settingsNs: probe.settingsNs,
        ...probe.provider === undefined ? {} : { provider: probe.provider },
        ...probe.baseURL === undefined || probe.baseURL.length === 0 ? {} : { baseURL: probe.baseURL },
        ...probe.api === undefined ? {} : { api: probe.api },
        ...probe.apiKey === undefined ? {} : { apiKey: probe.apiKey },
      })
      if (!response.result.ok) {
        setFailure(response.result.error.message)
        return
      }
      const found = response.result.value.models
      if (found.length === 0) {
        setFailure(t('fetchEmpty'))
        return
      }
      // Everything already configured starts unchecked, so adopting a
      // selection never silently rewrites a capacity the user corrected.
      const known = new Set(models.map(model => textOf(model, 'id')))
      setCandidates(found)
      setPicked(new Set(found.filter(model => !known.has(model.id)).map(model => model.id)))
    } catch (error) {
      // The transport rejected rather than answering; without this the button
      // would stay busy with nothing shown.
      setFailure(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  const closePicker = (): void => {
    setCandidates(undefined)
    setPicked(new Set())
  }

  const adoptPicked = (): void => {
    /* v8 ignore next -- the dialog only renders with candidates loaded */
    if (candidates === undefined) return
    const byId = new Map(models.map(model => [textOf(model, 'id'), model]))
    for (const candidate of candidates) {
      if (!picked.has(candidate.id)) continue
      // A row the user already tuned wins over the provider's own numbers.
      // Keyed by id, so a half-typed row whose id is still empty is not a
      // match and the candidate joins as its own row — correct, since a row
      // without an id is not yet a model and the create/apply gates refuse it.
      byId.set(candidate.id, byId.get(candidate.id) ?? adopt(candidate))
    }
    onChange([...byId.values()])
    closePicker()
  }

  const toggle = (id: string): void => {
    setPicked((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }

  const activeCandidates = candidates ?? []
  const allCandidatesPicked = activeCandidates.length > 0
    && activeCandidates.every(candidate => picked.has(candidate.id))

  const toggleAllCandidates = (): void => {
    setPicked((current) => {
      return activeCandidates.every(candidate => current.has(candidate.id))
        ? new Set()
        : new Set(activeCandidates.map(candidate => candidate.id))
    })
  }

  // A route the adapter already describes answers without an endpoint; only a
  // draft with neither has nothing to ask about.
  const askable = probe.provider !== undefined || (probe.baseURL !== undefined && probe.baseURL.length > 0)
  return (
    <section className={styles['modelCatalog']} aria-label={t('models')}>
      <div className={styles['modelListHead']}>
        <div className={styles['modelCatalogHeading']}>
          <span className={styles['modelCatalogTitle']}>{t('models')}</span>
          {props.overridden === undefined
            ? null
            : (
              <span className={styles['modelCatalogMeta']}>
                {props.overridden ? t('modelsCustomized') : t('modelsInherited')}
              </span>
            )}
        </div>
        {props.overridden === true && props.onReset !== undefined
          ? (
            <button
              type="button"
              className={styles['linkButton']}
              disabled={disabled}
              onClick={props.onReset}
            >
              {t('resetModels')}
            </button>
          )
          : null}
        <button
          type="button"
          className={styles['linkButton']}
          disabled={disabled || busy || !askable || props.probeBlocked !== undefined}
          title={props.probeBlocked !== undefined
            ? t(props.probeBlocked)
            : askable ? undefined : t('fetchNeedsBaseUrl')}
          onClick={() => { void fetchModels() }}
        >
          {busy ? t('fetching') : t('fetchModels')}
        </button>
      </div>
      {models.length === 0 ? <p className={styles['modelEmpty']}>{t('modelsEmpty')}</p> : null}
      {models.map((model, index) => {
        const modelId = textOf(model, 'id')
        const catalogInfo = modelId !== '' ? catalogOf(modelId, catalogMap) : undefined
        const inCatalog = catalogInfo !== undefined
        const isReasoningDisabled = disabled
        const defaultEfforts = catalogInfo?.defaultEfforts ?? []
        const currentValues = reasoningValuesOf(model, defaultEfforts)
        const isInheriting = inCatalog && model['contextWindow'] === undefined && model['maxTokens'] === undefined && model['reasoningEfforts'] === undefined

        return (
          <div
            key={index}
            className={`${styles['modelEntry']}${dropMarkClass(index)}`}
            onDragOver={(event) => {
              if (drag === null || drag.from === index) return
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
              setDrop({ index, half: rowHalfOf(event) })
            }}
            onDrop={(event) => {
              event.preventDefault()
              commitDrop({ index, half: rowHalfOf(event) })
            }}
          >
            <div className={styles['modelRow']}>
              <button
                type="button"
                className={styles['dragHandle']}
                aria-label={`${t('reorderModel')} ${index + 1}`}
                title={t('reorderModel')}
                draggable={!disabled}
                disabled={disabled}
                onDragStart={(event) => {
                  event.dataTransfer.setData('text/plain', modelId)
                  event.dataTransfer.effectAllowed = 'move'
                  setDrag({ from: index })
                }}
                onDragEnd={() => {
                  setDrag(null)
                  setDrop(null)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowUp' && index > 0) {
                    event.preventDefault()
                    move(index, index - 1)
                  }
                  if (event.key === 'ArrowDown' && index < models.length - 1) {
                    event.preventDefault()
                    move(index, index + 1)
                  }
                }}
              >
                <IconGripOutline14 />
              </button>
              <input
                className={styles['input']}
                type="text"
                value={textOf(model, 'id')}
                placeholder={t('modelId')}
                aria-label={`${t('modelId')} ${index + 1}`}
                disabled={disabled}
                onChange={(event) => { patch(index, { id: event.target.value }) }}
              />
              <input
                className={styles['input']}
                type="text"
                value={textOf(model, 'name')}
                placeholder={t('modelName')}
                aria-label={`${t('modelName')} ${index + 1}`}
                disabled={disabled}
                onChange={(event) => { patch(index, { name: event.target.value === '' ? undefined : event.target.value }) }}
              />
              <button
                type="button"
                className={styles['iconButton']}
                aria-label={`${t('modelAdvanced')} ${index + 1}`}
                aria-expanded={expanded.has(index)}
                title={t('modelAdvanced')}
                onClick={() => { toggleExpanded(index) }}
              >
                <IconChevron open={expanded.has(index)} />
              </button>
              <button
                type="button"
                className={`${styles['iconButton']} ${styles['iconButtonDanger']}`}
                aria-label={`${t('removeModel')} ${index + 1}`}
                title={t('removeModel')}
                disabled={disabled}
                onClick={() => { remove(index) }}
              >
                <IconTrash />
              </button>
            </div>
            {expanded.has(index)
              ? (
                <div className={styles['modelAdvanced']}>
                  <div className={styles['modalitiesRow']}>
                    <span className={styles['modalitiesLabel']}>{t('modelModalities')}</span>
                    <ModalityBadges
                      info={{
                        inputModalities: effectiveInputOf(model),
                        visionInferred: catalogInfo?.visionInferred,
                      }}
                      t={t}
                    />
                    {Array.isArray(model['input'])
                      ? <span className={styles['rowTag']}>{t('modalityCustomTag')}</span>
                      : null}
                    <button
                      type="button"
                      className={styles['iconButton']}
                      aria-label={`${t('editModelModalities')} ${index + 1}`}
                      title={t('editModelModalities')}
                      disabled={disabled}
                      onClick={() => { setModalityTarget(index) }}
                    >
                      <IconEditOutline16 size={14} />
                    </button>
                  </div>
                  {inCatalog ? (
                    <div className={styles['inheritRow']}>
                      <label className={styles['inheritLabel']}>
                        <input
                          type="checkbox"
                          checked={isInheriting}
                          disabled={disabled}
                          onChange={(event) => {
                            if (event.target.checked) {
                              patch(index, {
                                contextWindow: undefined,
                                maxTokens: undefined,
                                reasoningEfforts: undefined,
                              })
                            } else {
                              patch(index, {
                                reasoningEfforts: catalogInfo.supportsReasoning
                                  ? Object.fromEntries(defaultEfforts.map(k => [k, k]))
                                  : false,
                              })
                            }
                          }}
                        />
                        <span>{t('inheritModelSettings')}</span>
                      </label>
                      <span className={styles['modelFieldLabel']}>{t('inheritModelSettingsHint')}</span>
                    </div>
                  ) : null}
                  <label className={styles['modelField']}>
                    <span className={styles['modelFieldLabel']}>{t('modelContextWindow')}</span>
                    <input
                      className={styles['input']}
                      type="text"
                      inputMode="numeric"
                      value={capacityText(model, index, 'contextWindow')}
                      placeholder={CAPACITY_HINT.contextWindow}
                      aria-label={`${t('modelContextWindow')} ${index + 1}`}
                      disabled={disabled}
                      onChange={(event) => { editCapacity(index, 'contextWindow', event.target.value) }}
                    />
                  </label>
                  <label className={styles['modelField']}>
                    <span className={styles['modelFieldLabel']}>{t('modelMaxTokens')}</span>
                    <input
                      className={styles['input']}
                      type="text"
                      inputMode="numeric"
                      value={capacityText(model, index, 'maxTokens')}
                      placeholder={CAPACITY_HINT.maxTokens}
                      aria-label={`${t('modelMaxTokens')} ${index + 1}`}
                      disabled={disabled}
                      onChange={(event) => { editCapacity(index, 'maxTokens', event.target.value) }}
                    />
                  </label>
                  <label className={styles['modelField']}>
                    <span className={styles['modelFieldLabel']}>{t('modelReasoning')}</span>
                    <MultiSelect
                      className={styles['selectInput']}
                      values={currentValues}
                      aria-label={`${t('modelReasoning')} ${index + 1}`}
                      disabled={isReasoningDisabled}
                      placeholder={t('reasoningInherit')}
                      options={[
                        { value: 'minimal', label: t('reasoningMinimal') },
                        { value: 'low', label: t('reasoningLow') },
                        { value: 'medium', label: t('reasoningMedium') },
                        { value: 'high', label: t('reasoningHigh') },
                        { value: 'xhigh', label: t('reasoningXHigh') },
                        { value: 'max', label: t('reasoningMax') },
                      ]}
                      renderSummary={(selectedValues, options) => {
                        if (model['reasoningEfforts'] === undefined) {
                          return t('reasoningInherit')
                        }
                        if (selectedValues.length === 0) {
                          return t('reasoningNone')
                        }
                        if (selectedValues.length === 1) {
                          const opt = options.find(o => o.value === selectedValues[0])
                          return opt?.label ?? selectedValues[0]
                        }
                        return t('reasoningSelected').replace('{count}', String(selectedValues.length))
                      }}
                      onChange={(newValues) => {
                        if (newValues.length === 0) {
                          patch(index, { reasoningEfforts: false })
                        } else {
                          const map: Record<string, string> = {}
                          for (const v of newValues) {
                            map[v] = v
                          }
                          patch(index, { reasoningEfforts: map })
                        }
                      }}
                    />
                  </label>
                </div>
              )
              : null}
          </div>
        )
      })}
      {modalityTarget === undefined ? null : modalityDialogFor(modalityTarget)}
      <button
        type="button"
        className={styles['addModelButton']}
        disabled={disabled}
        onClick={() => { onChange([...models, { id: '' }]) }}
      >
        {t('addModel')}
      </button>
      {failure !== undefined ? <p className={styles['error']}>{failure}</p> : null}
      <Modal
        open={candidates !== undefined}
        onClose={closePicker}
        title={t('fetchTitle')}
        closeLabel={t('close')}
        description={t('fetchDescription')}
        className={styles['fetchDialog'] as string}
        footer={(
          <>
            <Button variant="outline" onClick={closePicker}>{t('cancel')}</Button>
            <Button variant="outline" onClick={adoptPicked}>{t('fetchAdopt')}</Button>
          </>
        )}
      >
        <div className={styles['candidateActions']}>
          <Button variant="ghost" size="sm" onClick={toggleAllCandidates}>
            {t(allCandidatesPicked ? 'fetchDeselectAll' : 'fetchSelectAll')}
          </Button>
        </div>
        <ul className={styles['candidateList']}>
          {(candidates ?? []).map(candidate => (
            <li key={candidate.id} className={styles['candidate']}>
              <label className={styles['candidateLabel']}>
                <input
                  type="checkbox"
                  checked={picked.has(candidate.id)}
                  onChange={() => { toggle(candidate.id) }}
                />
                {/* The id alone: it is the string adoption writes, and the
                    capacities the endpoint reported are adopted with it and
                    editable in the row that appears. */}
                <span className={styles['candidateId']}>{candidate.id}</span>
                {candidate.inputModalities && candidate.inputModalities.length > 0 ? (
                  <ModalityBadges info={candidate} t={t} />
                ) : null}
              </label>
            </li>
          ))}
        </ul>
      </Modal>
    </section>
  )
}
