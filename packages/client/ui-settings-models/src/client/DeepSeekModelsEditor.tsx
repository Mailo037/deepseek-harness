/**
 * Curated editor for the direct DeepSeek adapter's advisory model catalog.
 * The settings layer replaces `models` as one array, so the parent supplies
 * the effective inherited rows until the first edit materializes a user
 * override; reset removes that override instead of copying defaults into it.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import {
  IconChevronDownOutline14, IconChevronRightOutline14, IconEditOutline16, IconGripOutline14,
  IconPlusOutline16, IconTrashOutline16,
  Select,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { ModelModalityDialog, ModalityBadges } from './ModelModalityDialog.tsx'
import {
  indexAfterMove, indexAfterRemove, insertIndexOf, movedRows, reindexRowState, rekeyEditingBuffers,
  rowHalfOf, type RowHalf,
} from './reorder.ts'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/** One catalog entry kept structurally open so hidden or future fields survive an edit. */
export type DeepSeekModelDraft = Record<string, unknown>

/** The catalog fields this editor writes. */
type CatalogField = 'id' | 'name' | 'contextWindow' | 'maxTokens' | 'reasoningEffort'
  | 'inputModalities'

/** The two token counts edited as K/M-suffixed text behind a row's disclosure. */
type CapacityField = 'contextWindow' | 'maxTokens'

/** The modalities the direct DeepSeek adapter accepts, mirroring its MODEL_MODALITIES. */
const DEEPSEEK_MODALITIES: readonly string[] = ['text', 'image', 'video']

/** The adapter schema's modality default for a row without an override. */
const DEEPSEEK_DEFAULT_MODALITIES: readonly string[] = ['text']

/** Accepted capacity spellings: a decimal count with an optional K/M suffix. */
const CAPACITY_PATTERN = /^(\d+(?:\.\d+)?)([km])?$/i

/** Decimal suffix scales — `1M` is 1000K, matching how model capacities are quoted. */
const CAPACITY_SCALE = { k: 1_000, m: 1_000_000 } as const

/**
 * Read a typed capacity, so a user can write `256K` or `1M` instead of counting
 * zeroes. The stored value stays a plain token count.
 * @param text - raw field text.
 * @returns the count; `undefined` when blank (inherit), `NaN` when unreadable
 * (rejected by {@link validateDeepSeekModels} before any write).
 */
export function parseCapacity(text: string): number | undefined {
  const trimmed = text.trim()
  if (trimmed.length === 0) return undefined
  const match = CAPACITY_PATTERN.exec(trimmed)
  if (match === null) return Number.NaN
  const suffix = match[2]?.toLowerCase()
  const scale = suffix === 'k' || suffix === 'm' ? CAPACITY_SCALE[suffix] : 1
  const scaled = Number(match[1]) * scale
  // A decimal multiple is exact in intent but not in binary floating point
  // (2.3 * 1e6 lands a few ULPs high), so an integral intent snaps back.
  const rounded = Math.round(scaled)
  return Math.abs(scaled - rounded) < 1e-6 ? rounded : scaled
}

/**
 * Spell a stored count back in the shortest form that survives a round trip
 * through {@link parseCapacity}; a count that is not a whole number of
 * thousands stays written out.
 * @param value - stored capacity.
 * @returns the field text.
 */
export function formatCapacity(value: number): string {
  if (!Number.isInteger(value) || value <= 0) return String(value)
  if (value % CAPACITY_SCALE.m === 0) return `${String(value / CAPACITY_SCALE.m)}M`
  if (value % CAPACITY_SCALE.k === 0) return `${String(value / CAPACITY_SCALE.k)}K`
  return String(value)
}

/** A localized validation failure for one user-owned model array. */
export interface DeepSeekModelsValidationFailure {
  /** Zero-based model position. */
  index: number
  /** Message key owned by the Models settings section. */
  key: 'modelIdRequired' | 'modelIdDuplicate' | 'modelNameInvalid' | 'modelContextInvalid'
  | 'modelMaxTokensInvalid'
}

/** Convert a schema-validated catalog value into records without dropping hidden fields. */
export function modelDrafts(value: unknown): DeepSeekModelDraft[] {
  if (!Array.isArray(value)) return []
  return value.map(entry =>
    typeof entry === 'object' && entry !== null && !Array.isArray(entry)
      ? entry as DeepSeekModelDraft
      : {})
}

/**
 * Validate adapter constraints that the serialized schema cannot express.
 * @param value - user-owned `models` value, or undefined while inherited.
 * @returns the first invalid row, or undefined when the adapter will accept it.
 */
export function validateDeepSeekModels(value: unknown): DeepSeekModelsValidationFailure | undefined {
  if (value === undefined) return undefined
  const models = modelDrafts(value)
  const seen = new Set<string>()
  for (const [index, model] of models.entries()) {
    // Compared trimmed: surrounding whitespace is a paste artifact the adapter
    // would never match, and an untrimmed compare lets `model ` slip past the
    // duplicate check against its own twin.
    const id = model['id']
    const trimmed = typeof id === 'string' ? id.trim() : undefined
    if (trimmed === undefined || trimmed.length === 0) return { index, key: 'modelIdRequired' }
    if (seen.has(trimmed)) return { index, key: 'modelIdDuplicate' }
    seen.add(trimmed)
    const name = model['name']
    if (name !== undefined && (typeof name !== 'string' || name.length === 0)) {
      return { index, key: 'modelNameInvalid' }
    }
    const contextWindow = model['contextWindow']
    if (contextWindow !== undefined
      && (typeof contextWindow !== 'number' || !Number.isInteger(contextWindow) || contextWindow <= 0)) {
      return { index, key: 'modelContextInvalid' }
    }
    const maxTokens = model['maxTokens']
    if (maxTokens !== undefined
      && (typeof maxTokens !== 'number' || !Number.isInteger(maxTokens) || maxTokens <= 0)) {
      return { index, key: 'modelMaxTokensInvalid' }
    }
  }
  return undefined
}

/** Props of {@link DeepSeekModelsEditor}. */
export interface DeepSeekModelsEditorProps {
  /** Effective rows: inherited until the parent materializes an override. */
  models: readonly DeepSeekModelDraft[]
  /** Whether the user layer currently owns the whole array. */
  overridden: boolean
  /** Fallback context capacity used when a row omits its exact value. */
  defaultContextWindow: number | undefined
  /** Fallback output cap used when a row omits its exact value. */
  defaultMaxTokens: number | undefined
  /** Section copy. */
  t: (key: keyof typeof en) => string
  /** Disable every mutation. */
  disabled: boolean
  /** Replace the user-owned array after one visible edit. */
  onChange: (models: DeepSeekModelDraft[]) => void
  /** Remove the user-owned array and return to inheritance. */
  onReset: () => void
}

/**
 * Render the direct DeepSeek adapter's model catalog: id and display name on
 * each row, capacities behind the row's own disclosure.
 * @param props - effective rows plus the array-level override actions.
 * @returns the catalog editor.
 */
export function DeepSeekModelsEditor(props: DeepSeekModelsEditorProps): ReactNode {
  // Capacities are edited as text, so a field's keystrokes are held here
  // rather than re-derived from the parsed count on every change, which would
  // rewrite `1000` to `1K` mid-word. Unreadable text is kept past blur so the
  // save-time rejection names a row the user can still see — which is why
  // this is one entry PER FIELD: a single active buffer would be displaced by
  // editing any other field, and the abandoned one would fall back to
  // rendering its stored NaN as the literal `NaN`.
  //
  // Keys carry the row index, so the operations that move indexes maintain
  // them: `move` and `remove` re-key around the row that moved or dropped, and
  // reset clears them all because the rows they annotated are gone.
  const [editing, setEditing] = useState<ReadonlyMap<string, string>>(() => new Map())
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set())
  // The open modality-override dialog targets one row index; undefined while closed.
  const [modalityTarget, setModalityTarget] = useState<number | undefined>(undefined)
  // Drag reorder: the dragged row while a drag runs, and the hovered row half
  // that positions the insert marker — the same pair the provider list keeps.
  const [drag, setDrag] = useState<{ from: number } | null>(null)
  const [drop, setDrop] = useState<{ index: number; half: RowHalf } | null>(null)

  const update = (index: number, key: CatalogField, value: unknown): void => {
    const next = props.models.map((model, at) => {
      const copy = { ...model }
      if (at !== index) return copy
      if (value === undefined) Reflect.deleteProperty(copy, key)
      else copy[key] = value
      return copy
    })
    props.onChange(next)
  }

  const remove = (index: number): void => {
    const shifted = (at: number): number | undefined => indexAfterRemove(at, index)
    setEditing(current => rekeyEditingBuffers(current, shifted))
    setExpanded(current => reindexRowState(current, shifted))
    setModalityTarget(current => (current === undefined ? undefined : shifted(current)))
    props.onChange(props.models.filter((_model, at) => at !== index).map(model => ({ ...model })))
  }

  const move = (from: number, to: number): void => {
    setDrag(null)
    setDrop(null)
    if (to === from) return
    /* v8 ignore next -- drag and keyboard moves always name an existing row */
    if (props.models[from] === undefined) return
    const shifted = (at: number): number => indexAfterMove(at, from, to)
    setEditing(current => rekeyEditingBuffers(current, shifted))
    setExpanded(current => reindexRowState(current, shifted))
    setModalityTarget(current => (current === undefined ? undefined : shifted(current)))
    props.onChange(movedRows(props.models, from, to).map(model => ({ ...model })))
  }

  const commitDrop = (over: { index: number; half: RowHalf }): void => {
    if (drag === null) return
    move(drag.from, insertIndexOf(drag.from, over))
  }

  const reset = (): void => {
    setEditing(new Map())
    setExpanded(new Set())
    props.onReset()
  }

  const toggle = (index: number): void => {
    setExpanded((current) => {
      const next = new Set(current)
      if (!next.delete(index)) next.add(index)
      return next
    })
  }

  /** The modalities a row answers with: its override, else the schema default. */
  const effectiveModalities = (model: DeepSeekModelDraft): readonly string[] => {
    const stored = model['inputModalities']
    if (!Array.isArray(stored)) return DEEPSEEK_DEFAULT_MODALITIES
    const known = stored.filter((value): value is string =>
      typeof value === 'string' && DEEPSEEK_MODALITIES.includes(value))
    // The schema floors the list at one entry, so a cleared override reads as the default again.
    return known.length > 0 ? known : DEEPSEEK_DEFAULT_MODALITIES
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
    const model = props.models[target]
    /* v8 ignore next -- move and remove re-map the open dialog onto its row */
    if (model === undefined) return null
    return (
      <ModelModalityDialog
        choices={DEEPSEEK_MODALITIES}
        selected={effectiveModalities(model)}
        allowEmpty={false}
        t={props.t}
        onApply={(next) => {
          update(target, 'inputModalities', [...next])
          setModalityTarget(undefined)
        }}
        onClose={() => { setModalityTarget(undefined) }}
      />
    )
  }

  /** The field's text: its live keystrokes, else the stored count spelled short. */
  const capacityText = (model: DeepSeekModelDraft, index: number, field: CapacityField): string => {
    const typed = editing.get(`${String(index)}:${field}`)
    if (typed !== undefined) return typed
    const value = model[field]
    return typeof value === 'number' ? formatCapacity(value) : ''
  }

  const settleCapacity = (index: number, field: CapacityField): void => {
    const key = `${String(index)}:${field}`
    const typed = editing.get(key)
    if (typed === undefined) return
    // Unreadable text stays on screen: the save-time rejection names a row the
    // user can still see and correct.
    const parsed = parseCapacity(typed)
    if (parsed !== undefined && Number.isNaN(parsed)) return
    setEditing((current) => {
      const next = new Map(current)
      next.delete(key)
      return next
    })
  }

  /** One capacity field of one row, rendered inside the row's disclosure. */
  const capacityField = (
    model: DeepSeekModelDraft,
    index: number,
    field: CapacityField,
    fallback: number | undefined,
  ): ReactNode => (
    <label className={styles['modelField']}>
      <span className={styles['modelFieldLabel']}>{props.t(field === 'contextWindow' ? 'contextWindow' : 'maxTokens')}</span>
      <input
        className={styles['input']}
        type="text"
        inputMode="numeric"
        value={capacityText(model, index, field)}
        placeholder={fallback === undefined
          ? props.t(field === 'contextWindow' ? 'contextWindowPlaceholder' : 'maxTokensPlaceholder')
          : formatCapacity(fallback)}
        aria-label={`${props.t(field === 'contextWindow' ? 'contextWindow' : 'maxTokens')} ${String(index + 1)}`}
        disabled={props.disabled}
        onChange={(event) => {
          const text = event.target.value
          setEditing(current => new Map(current).set(`${String(index)}:${field}`, text))
          update(index, field, parseCapacity(text))
        }}
        onBlur={() => { settleCapacity(index, field) }}
      />
    </label>
  )

  return (
    <section className={styles['modelCatalog']} aria-label={props.t('models')}>
      <div className={styles['modelListHead']}>
        <div className={styles['modelCatalogHeading']}>
          <span className={styles['modelCatalogTitle']}>{props.t('models')}</span>
          <span className={styles['modelCatalogMeta']}>
            {props.overridden ? props.t('modelsCustomized') : props.t('modelsInherited')}
          </span>
        </div>
        {props.overridden
          ? (
            <button
              type="button"
              className={styles['linkButton']}
              disabled={props.disabled}
              onClick={reset}
            >
              {props.t('resetModels')}
            </button>
          )
          : null}
      </div>
      {props.models.length === 0
        ? <p className={styles['modelEmpty']}>{props.t('modelsEmpty')}</p>
        : (
          <div className={styles['modelList']}>
            {props.models.map((model, index) => (
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
                    aria-label={`${props.t('reorderModel')} ${String(index + 1)}`}
                    title={props.t('reorderModel')}
                    draggable={!props.disabled}
                    disabled={props.disabled}
                    onDragStart={(event) => {
                      event.dataTransfer.setData('text/plain', typeof model['id'] === 'string' ? model['id'] : '')
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
                      if (event.key === 'ArrowDown' && index < props.models.length - 1) {
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
                    value={typeof model['id'] === 'string' ? model['id'] : ''}
                    placeholder={props.t('modelId')}
                    aria-label={`${props.t('modelId')} ${String(index + 1)}`}
                    disabled={props.disabled}
                    onChange={(event) => { update(index, 'id', event.target.value) }}
                    onBlur={(event) => {
                      // Settle a pasted id rather than trimming per keystroke,
                      // which would stop the user typing an interior space.
                      const trimmed = event.target.value.trim()
                      if (trimmed !== event.target.value) update(index, 'id', trimmed)
                    }}
                  />
                  <input
                    className={styles['input']}
                    type="text"
                    value={typeof model['name'] === 'string' ? model['name'] : ''}
                    placeholder={props.t('modelName')}
                    aria-label={`${props.t('modelName')} ${String(index + 1)}`}
                    disabled={props.disabled}
                    onChange={(event) => {
                      update(index, 'name', event.target.value === '' ? undefined : event.target.value)
                    }}
                  />
                  <button
                    type="button"
                    className={styles['iconButton']}
                    aria-label={`${props.t('modelAdvanced')} ${String(index + 1)}`}
                    aria-expanded={expanded.has(index)}
                    title={props.t('modelAdvanced')}
                    onClick={() => { toggle(index) }}
                  >
                    {expanded.has(index) ? <IconChevronDownOutline14 /> : <IconChevronRightOutline14 />}
                  </button>
                  <button
                    type="button"
                    className={`${styles['iconButton']} ${styles['iconButtonDanger']}`}
                    aria-label={`${props.t('removeModel')} ${String(index + 1)}`}
                    title={props.t('removeModel')}
                    disabled={props.disabled}
                    onClick={() => { remove(index) }}
                  >
                    <IconTrashOutline16 size={14} />
                  </button>
                </div>
                {expanded.has(index)
                  ? (
                    <div className={styles['modelAdvanced']}>
                      <div className={styles['modalitiesRow']}>
                        <span className={styles['modalitiesLabel']}>{props.t('modelModalities')}</span>
                        <ModalityBadges info={{ inputModalities: effectiveModalities(model) }} t={props.t} />
                        {Array.isArray(model['inputModalities'])
                          ? <span className={styles['rowTag']}>{props.t('modalityCustomTag')}</span>
                          : null}
                        <button
                          type="button"
                          className={styles['iconButton']}
                          aria-label={`${props.t('editModelModalities')} ${String(index + 1)}`}
                          title={props.t('editModelModalities')}
                          disabled={props.disabled}
                          onClick={() => { setModalityTarget(index) }}
                        >
                          <IconEditOutline16 size={14} />
                        </button>
                      </div>
                      {capacityField(model, index, 'contextWindow', props.defaultContextWindow)}
                      {capacityField(model, index, 'maxTokens', props.defaultMaxTokens)}
                      <label className={styles['modelField']}>
                        <span className={styles['modelFieldLabel']}>{props.t('modelReasoning')}</span>
                        <Select
                          className={styles['selectInput']}
                          value={typeof model['reasoningEffort'] === 'string' ? model['reasoningEffort'] : ''}
                          aria-label={`${props.t('modelReasoning')} ${String(index + 1)}`}
                          disabled={props.disabled}
                          options={[
                            { value: '', label: props.t('reasoningInherit') },
                            { value: 'off', label: props.t('reasoningOff') },
                            { value: 'low', label: props.t('reasoningLow') },
                            { value: 'high', label: props.t('reasoningHigh') },
                            { value: 'max', label: props.t('reasoningMax') },
                          ]}
                          onChange={(effort) => {
                            update(index, 'reasoningEffort', effort === '' ? undefined : effort)
                          }}
                        />
                      </label>
                    </div>
                  )
                  : null}
              </div>
            ))}
          </div>
        )}
      {modalityTarget === undefined ? null : modalityDialogFor(modalityTarget)}
      <button
        type="button"
        className={styles['addModelButton']}
        disabled={props.disabled}
        onClick={() => { props.onChange([...props.models.map(model => ({ ...model })), { id: '' }]) }}
      >
        <IconPlusOutline16 size={14} />
        {props.t('addModel')}
      </button>
    </section>
  )
}
