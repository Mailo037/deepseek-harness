/**
 * ModelSelect: the composer's named model seat (`conversation.input.model`).
 * Two-level selection per figma 496:26454's MenuDropdown: the root menu is
 * the Model / Effort row pair (label + current value + a right chevron),
 * each drilling into its own list — the provider-grouped model list over
 * the shared directory, and the effort levels. The trigger (313:14108's
 * ToggleButton) shows both: model name + effort in the caption tone.
 * Data and submission ride the SAME per-session ModelDirectory as the
 * /model popup; exact-model reasoning metadata and the selected effort come
 * from the Host rather than a client-owned vocabulary. A rejected selection
 * announces through the shared transient Toast anchored to the composer
 * card; the in-menu strip with Retry remains the catalog-load surface.
 */
import {
  useEffect, useLayoutEffect, useId, useMemo, useRef, useState, useSyncExternalStore,
  type CSSProperties, type KeyboardEvent, type FocusEvent,
} from 'react'
import clsx from 'clsx'
import {
  BottomSheet, ElevatorLabel, IconCheckOutline16, IconChevronDownOutline14, IconChevronRightOutline14,
  IconCloseFill14, IconImageOutline14, IconSearchOutline16, IconVideoOutline14,
  IconWarningOutline16, HoverCard, Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  ModelCatalogModel, ModelReasoningEffort, ModelSelection,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelSelectInjected } from './slots.ts'
import type { ModelKey } from './locales.ts'
import css from './ModelSelect.module.css'

/** Which pane the dropdown shows: the two-row root or one drilled-in list. */
type Pane = 'root' | 'model' | 'effort'

/** One dynamic effort row; undefined means preserve the provider default. */
interface EffortChoice {
  key: string
  effort: string | undefined
  label: string
  description?: string
}

/** Render one modality as an unframed, compact icon. */
function ModalityBadge({ modality }: { modality: string }) {
  if (modality === 'image') {
    return (
      <span className={css.modalityIcon} data-model-modality-icon="image" aria-hidden="true">
        <IconImageOutline14 size={14} />
      </span>
    )
  }
  if (modality === 'video') {
    return (
      <span className={css.modalityIcon} data-model-modality-icon="video" aria-hidden="true">
        <IconVideoOutline14 size={14} />
      </span>
    )
  }
  return (
    <span className={clsx(css.modalityIcon, css.modalityT)} data-model-modality-icon="text" aria-hidden="true">T</span>
  )
}

/** Translate a known modality and preserve adapter-specific names verbatim. */
function modalityLabel(modality: string, t: (key: ModelKey) => string): string {
  if (modality === 'image') return t('modality.image')
  if (modality === 'video') return t('modality.video')
  if (modality === 'text') return t('modality.text')
  return modality
}

/** Present token capacities compactly without making their precision ambiguous. */
function formatTokenCount(tokens: number | undefined, unknown: string): string {
  if (tokens === undefined) return unknown
  if (tokens >= 1_048_576 && tokens % 1_048_576 === 0) return `${String(tokens / 1_048_576)}M`
  if (tokens >= 1_000_000 && tokens % 1_000_000 === 0) return `${String(tokens / 1_000_000)}M`
  if (tokens >= 1_000 && tokens % 1_000 === 0) return `${String(tokens / 1_000)}K`
  if (tokens >= 1_024 && tokens % 1_024 === 0) return `${String(tokens / 1_024)}K`
  return tokens.toLocaleString()
}

/** Exact, adapter-advertised details shown in a model row's hover card. */
function ModelInfoCard({ model, t }: { model: ModelCatalogModel; t: (key: ModelKey) => string }) {
  const unknown = t('modelInfo.unknown')
  const modalities = model.inputModalities?.map(modality => modalityLabel(modality, t)).join(' · ') ?? unknown
  return (
    <div className={css.modelInfoCard} data-model-info-card="">
      <div className={css.modelInfoRow}>
        <span>{t('modelInfo.id')}</span>
        <code>{model.id}</code>
      </div>
      <div className={css.modelInfoRow}>
        <span>{t('modelInfo.context')}</span>
        <strong>{formatTokenCount(model.contextWindow, unknown)}</strong>
      </div>
      <div className={css.modelInfoRow}>
        <span>{t('modelInfo.maxOutput')}</span>
        <strong>{formatTokenCount(model.maxTokens, unknown)}</strong>
      </div>
      <div className={css.modelInfoRow}>
        <span>{t('modelInfo.modalities')}</span>
        <strong>{modalities}</strong>
      </div>
    </div>
  )
}

const MODALITY_ALIASES: Record<string, readonly string[]> = {
  image: ['image', 'images', 'img', 'vision', 'bild', 'bilder', 'foto', 'photo', 'picture', 'pic'],
  video: ['video', 'videos', 'vid', 'film', 'clip'],
  text: ['text', 'txt'],
  audio: ['audio', 'sound', 'voice', 'ton', 'sprache', 'speech'],
}

/** Viewport clearance every open menu keeps on each edge (mirrors the Menu primitive's portal margin). */
const MENU_VIEWPORT_MARGIN = 8

/**
 * Place the model menu inside the viewport: preferred right-aligned with the
 * trigger and opening upward (the CSS default), then clamped to the viewport
 * with an 8px margin on every edge, flipping below the trigger when the space
 * above is exhausted. Root-relative coordinates keep the menu absolutely
 * anchored to the trigger, so a scroll moves both together.
 * @param root - the positioned `.root` box the absolute menu is relative to.
 * @param trigger - the trigger button rect (viewport coordinates).
 * @param menu - the open menu element, laid out so offsetWidth/Height are real.
 * @returns root-relative left/top for the menu's inline style.
 */
export function placeMenu(
  root: { getBoundingClientRect(): DOMRect },
  trigger: { getBoundingClientRect(): DOMRect },
  menu: { offsetWidth: number; offsetHeight: number },
): { left: number; top: number } {
  const MARGIN = MENU_VIEWPORT_MARGIN
  const vw = window.innerWidth
  const vh = window.innerHeight
  const rootRect = root.getBoundingClientRect()
  const t = trigger.getBoundingClientRect()
  const lw = menu.offsetWidth
  const lh = menu.offsetHeight
  // Preferred: right-aligned with the trigger, opening upward (8px gap).
  let x = t.right - lw
  let y = t.top - lh - 8
  if (y < MARGIN && lh > 0 && t.bottom + lh + 8 <= vh - MARGIN) y = t.bottom + 8
  if (lw > 0) x = Math.min(Math.max(x, MARGIN), vw - lw - MARGIN)
  if (lh > 0) y = Math.min(Math.max(y, MARGIN), vh - lh - MARGIN)
  return { left: x - rootRect.left, top: y - rootRect.top }
}

/** Check whether a model's modalities match a search token. */
function modelMatchesModality(modalities: readonly string[] | undefined, token: string): boolean {
  if (!modalities || modalities.length === 0) return false
  return modalities.some((mod) => {
    const lower = mod.toLowerCase()
    if (lower.includes(token) || token.includes(lower)) return true
    const aliases = MODALITY_ALIASES[lower]
    return aliases !== undefined && aliases.some(alias => alias === token || alias.includes(token) || token.includes(alias))
  })
}

/**
 * Render the composer model seat.
 * @param props - owner share (locked) + injected face (shared directory
 * store/verbs) + the standard locale seat.
 * @returns the trigger and, while open, the two-level menu.
 */
export function ModelSelect(
  { locked, available, directory, load, select, t }:
  ModelSelectInjected & { locked: boolean } & PropsLocale<'model'>,
) {
  const state = useSyncExternalStore(
    fn => directory.subscribe(fn),
    () => directory.getSnapshot(),
  )
  const [open, setOpen] = useState(false)
  const [pane, setPane] = useState<Pane>('root')
  // The in-menu error strip serves catalog loads (its Retry re-runs the
  // load); a rejected SELECTION announces through the transient toast
  // instead, so the strip renders only while the latest failure-capable
  // action was a load.
  const lastActionRef = useRef<'load' | 'select'>('load')
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)
  const toastSeq = useRef(0)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const id = useId()

  // Viewport-clamped menu placement on desktop: the CSS default (right-aligned,
  // above the trigger) can run off the screen near an edge, so the open menu
  // is re-placed from the trigger rect before paint, on every resize, and on
  // every open-menu size change — drilling into a pane, a catalog load, or a
  // group expansion all grow the card after the initial placement, and a
  // top-anchored card would otherwise extend past the viewport's bottom edge.
  // `null` keeps the CSS default while the card remains invisible. A browser
  // can report zero height on its first layout pass; publishing that
  // incomplete measurement would put an upward menu just above the trigger
  // by its top edge, then visibly jump it upward once ResizeObserver reports
  // its real height. On phone the CSS media query turns the card into a
  // bottom-anchored sheet whose height the `--sheet-h` custom property owns,
  // so no inline placement is needed — the sentinel below only reveals it.
  const [phone, setPhone] = useState(
    () => typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 639px)').matches,
  )
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(max-width: 639px)')
    const onChange = (): void => { setPhone(query.matches) }
    query.addEventListener('change', onChange)
    return () => { query.removeEventListener('change', onChange) }
  }, [])
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    if (!open || phone) { setMenuPos(null); return }
    const place = (): void => {
      if (rootRef.current === null || triggerRef.current === null || menuRef.current === null) return
      // Keep the CSS upward placement transparent and non-interactive until a
      // complete measurement is available. ResizeObserver re-enters `place`
      // once the open card has a real height.
      if (menuRef.current.offsetHeight === 0) return
      setMenuPos(placeMenu(rootRef.current, triggerRef.current, menuRef.current))
    }
    place()
    window.addEventListener('resize', place)
    /* v8 ignore next 4 -- jsdom ships no ResizeObserver, so its absence arm
       only runs under test; the constructor arm runs in every real browser. */
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : undefined
    if (observer !== undefined && menuRef.current !== null) observer.observe(menuRef.current)
    return () => {
      window.removeEventListener('resize', place)
      observer?.disconnect()
    }
  }, [open, phone])

  const choices = useMemo(() => state.groups.flatMap(group =>
    group.models.map(model => ({
      group,
      model,
      selection: {
        provider: group.id,
        model: model.id,
        ...model.reasoning?.defaultEffort === undefined
          ? {}
          : { reasoningEffort: model.reasoning.defaultEffort },
      } satisfies ModelSelection,
    }))), [state.groups])
  const current = state.current
  const selectedIndex = current === null
    ? -1
    : choices.findIndex(c => c.selection.provider === current.provider && c.selection.model === current.model)
  const currentChoice = choices[selectedIndex]
  const reasoning = currentChoice?.model.reasoning
  const effectiveEffort = state.current?.reasoningEffort ?? reasoning?.defaultEffort
  const effortLabel = reasoning === undefined
    ? undefined
    : effectiveEffort === undefined
      ? t('effort.providerDefault')
      : reasoning.efforts.find(level => level.id === effectiveEffort)?.name ?? effectiveEffort
  const effortChoices = useMemo<readonly EffortChoice[]>(() => reasoning === undefined
    ? []
    : [
      ...reasoning.defaultEffort === undefined
        ? [{ key: 'provider-default', effort: undefined, label: t('effort.providerDefault') }]
        : [],
      ...reasoning.efforts.map((effort: ModelReasoningEffort) => ({
        key: `effort:${effort.id}`,
        effort: effort.id,
        label: effort.name,
        ...effort.description === undefined ? {} : { description: effort.description },
      })),
    ], [reasoning, t])
  const busy = state.status === 'selecting'

  const [searchQuery, setSearchQuery] = useState('')
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(() => new Set())
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  const toggleGroup = (groupId: string): void => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }

  const normalizedQuery = searchQuery.trim().toLowerCase()
  const filteredGroups = useMemo(() => {
    if (!normalizedQuery) return state.groups
    const tokens = normalizedQuery.split(/\s+/).filter(Boolean)
    return state.groups
      .map((group) => {
        const groupNameLower = group.name.toLowerCase()
        const groupIdLower = group.id.toLowerCase()
        const matchingModels = group.models.filter((m) => {
          const nameLower = m.name.toLowerCase()
          const idLower = m.id.toLowerCase()
          const descLower = m.description?.toLowerCase() ?? ''
          return tokens.every(token =>
            groupNameLower.includes(token) ||
            groupIdLower.includes(token) ||
            nameLower.includes(token) ||
            idLower.includes(token) ||
            descLower.includes(token) ||
            modelMatchesModality(m.inputModalities, token),
          )
        })
        if (matchingModels.length === 0) return null
        return {
          ...group,
          models: matchingModels,
        }
      })
      .filter((g): g is NonNullable<typeof g> => g !== null)
  }, [state.groups, normalizedQuery])

  const reload = (): void => {
    lastActionRef.current = 'load'
    load()
  }

  // Mount-time load resolves the trigger label; every open refreshes.
  useEffect(() => {
    if (available) {
      lastActionRef.current = 'load'
      load()
    }
  }, [available, load])

  useEffect(() => {
    // On phone the portaled bottom sheet sits outside `rootRef`, so an outside
    // pointer would immediately close it; the sheet's mask owns dismissal there.
    if (!open || phone) return
    const closeOutside = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', closeOutside)
    return () => { document.removeEventListener('mousedown', closeOutside) }
  }, [open, phone])

  if (!available) return null

  const show = (): void => {
    setPane('root')
    setMenuPos(null)
    setOpen(true)
    reload()
  }

  const close = (restoreFocus = false): void => {
    setOpen(false)
    setPane('root')
    if (restoreFocus) queueMicrotask(() => { triggerRef.current?.focus() })
  }

  const moveFocus = (offset: number): void => {
    const items = itemRefs.current.filter(item => item !== null)
    if (items.length === 0) return
    const active = items.findIndex(item => item === document.activeElement)
    const next = (Math.max(active, 0) + offset + items.length) % items.length
    items[next]?.focus()
  }

  const onRootKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      // Escape backs out of a drilled pane first, then closes.
      if (pane !== 'root') setPane('root')
      else close(true)
      return
    }
    if (!open) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveFocus(event.key === 'ArrowDown' ? 1 : -1)
    }
  }

  const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
    // On phone the portaled bottom sheet takes focus, so a root blur is not a
    // dismissal signal; only the desktop dropdown closes on focus leaving.
    if (phone) return
    if (event.relatedTarget instanceof Node && rootRef.current?.contains(event.relatedTarget)) return
    close()
  }

  const settleSelection = (accepted: boolean): void => {
    if (accepted) {
      if (rootRef.current !== null) close(true)
      return
    }
    const message = directory.getSnapshot().error
    if (message !== null) {
      toastSeq.current += 1
      setToast({ seq: toastSeq.current, text: t('error.action', { message }) })
    }
  }

  const choose = (selection: ModelSelection): void => {
    if (state.current !== null && state.current.provider === selection.provider && state.current.model === selection.model) {
      close(true)
      return
    }
    lastActionRef.current = 'select'
    void select(selection).then(settleSelection)
  }

  const chooseEffort = (effort: string | undefined): void => {
    if (state.current === null) return
    if (effectiveEffort === effort) {
      close(true)
      return
    }
    const selection: ModelSelection = {
      provider: state.current.provider,
      model: state.current.model,
      ...effort === undefined ? {} : { reasoningEffort: effort },
    }
    lastActionRef.current = 'select'
    void select(selection).then(settleSelection)
  }

  const modelLabel = currentChoice?.model.name ?? t('trigger.fallback')
  const triggerLabel = effortLabel === undefined ? modelLabel : `${modelLabel} · ${effortLabel}`
  const triggerAria = currentChoice === undefined
    ? t('trigger.selectAria')
    : effortLabel === undefined
      ? t('trigger.aria', { model: modelLabel })
      : t('trigger.ariaEffort', { model: modelLabel, effort: effortLabel })
  itemRefs.current = []
  let itemIndex = 0
  const itemRef = () => {
    const at = itemIndex++
    return (node: HTMLButtonElement | null) => { itemRefs.current[at] = node }
  }

  // Menu geometry on desktop: `null` keeps the CSS default while the card stays
  // invisible (pre-paint, before placement); a placed left/top override the
  // upward CSS default, and the explicit right/bottom auto stop the CSS default
  // from stretching the card between the two. On phone the shared BottomSheet
  // owns the surface, so no inline geometry is needed here.
  const menuStyle: CSSProperties = menuPos === null
    ? { opacity: 0, pointerEvents: 'none' }
    : { left: menuPos.left, top: menuPos.top, right: 'auto', bottom: 'auto' }

  // The two-level menu body, shared by the desktop dropdown card and the phone
  // bottom sheet so the second-level panes behave identically on both.
  const paneContent = (
    <>
      {pane === 'root' && (
        <>
          <button ref={itemRef()} type="button" role="menuitem" className={css.cell} onClick={() => { setPane('model') }}>
            <span className={css.cellLabel}>{t('menu.model')}</span>
            <span className={css.cellValue}>{modelLabel}</span>
            <IconChevronRightOutline14 className={css.cellChevron} />
          </button>
          {reasoning !== undefined && (
            <button ref={itemRef()} type="button" role="menuitem" className={css.cell} onClick={() => { setPane('effort') }}>
              <span className={css.cellLabel}>{t('menu.effort')}</span>
              <span className={css.cellValue}>{effortLabel}</span>
              <IconChevronRightOutline14 className={css.cellChevron} />
            </button>
          )}
        </>
      )}

      {pane === 'model' && (
        <>
          <div className={css.searchBox}>
            <IconSearchOutline16 size={14} className={css.searchIcon} />
            <input
              ref={searchInputRef}
              type="text"
              className={css.searchInput}
              value={searchQuery}
              placeholder={t('search.placeholder')}
              aria-label={t('search.placeholder')}
              onChange={(e) => { setSearchQuery(e.target.value) }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  moveFocus(1)
                } else if (e.key === 'Escape' && searchQuery) {
                  e.preventDefault()
                  e.stopPropagation()
                  setSearchQuery('')
                }
              }}
            />
            {searchQuery.length > 0 && (
              <button
                type="button"
                className={css.searchClear}
                onClick={() => {
                  setSearchQuery('')
                  searchInputRef.current?.focus()
                }}
                aria-label="Clear search"
              >
                <IconCloseFill14 size={12} />
              </button>
            )}
          </div>
          {state.status === 'loading' && (
            <div className={css.status}>{t('status.loading')}</div>
          )}
          {state.error !== null && lastActionRef.current === 'load' && (
            <div className={css.error}>
              <span>{t('error.action', { message: state.error })}</span>
              <button type="button" className={css.retry} onClick={reload}>{t('retry')}</button>
            </div>
          )}
          {state.failures.map(failure => (
            <div className={css.warning} key={failure.id}>
              <span>{t('warning.groupLoad', { name: failure.name, message: failure.message })}</span>
              <button type="button" className={css.retry} onClick={reload}>{t('retry')}</button>
            </div>
          ))}
          <div className={clsx(css.groups, 'scrollable')}>
            {filteredGroups.map((group) => {
              const headingId = `${id}-${group.id}`
              const isCollapsed = normalizedQuery ? false : collapsedGroups.has(group.id)
              return (
                <section role="group" aria-labelledby={headingId} className={css.group} key={group.id}>
                  <div className={css.groupHeaderRow}>
                    <button
                      type="button"
                      className={css.groupHeader}
                      onClick={() => { toggleGroup(group.id) }}
                      aria-expanded={!isCollapsed}
                      title={group.name}
                    >
                      <span className={css.groupTitle} id={headingId}>{group.name}</span>
                      <span className={css.groupCount}>{group.models.length}</span>
                      <IconChevronDownOutline14 className={clsx(css.groupChevron, isCollapsed && css.groupChevronCollapsed)} />
                    </button>
                  </div>
                  {!isCollapsed && group.models.map((model) => {
                    const selected = state.current?.provider === group.id && state.current.model === model.id
                    return (
                      <HoverCard
                        key={model.id}
                        openDelayMs={300}
                        anchor={(
                          <button
                            ref={itemRef()}
                            type="button"
                            role="menuitemradio"
                            aria-checked={selected}
                            className={clsx(css.option, selected && css.selected)}
                            title={model.name}
                            disabled={busy}
                            onClick={() => { choose({ provider: group.id, model: model.id }) }}
                          >
                            <span className={css.check}>
                              {selected ? <IconCheckOutline16 /> : null}
                            </span>
                            <span className={css.optionCopy}>
                              <span className={css.modelName}>{model.name}</span>
                              {model.description !== undefined && (
                                <span className={css.description}>{model.description}</span>
                              )}
                            </span>
                            <span className={css.modalityBadges}>
                              {model.inputModalities?.map(mod => (
                                <ModalityBadge key={mod} modality={mod} />
                              ))}
                            </span>
                          </button>
                        )}
                        content={<ModelInfoCard model={model} t={t} />}
                      />
                    )
                  })}
                </section>
              )
            })}
          </div>
          {state.status === 'ready' && filteredGroups.length === 0 && (
            <div className={css.empty}>{normalizedQuery ? t('empty.search') : t('empty.models')}</div>
          )}
        </>
      )}

      {pane === 'effort' && (
        <>
          {state.error !== null && lastActionRef.current === 'load' && (
            <div className={css.error}>
              <span>{t('error.action', { message: state.error })}</span>
              <button type="button" className={css.retry} onClick={reload}>{t('action.reload')}</button>
            </div>
          )}
          {effortChoices.length === 0
            ? <div className={css.empty}>{t('empty.efforts')}</div>
            : effortChoices.map(level => (
              <button
                ref={itemRef()}
                type="button"
                role="menuitemradio"
                aria-checked={effectiveEffort === level.effort}
                className={clsx(css.option, effectiveEffort === level.effort && css.selected)}
                key={level.key}
                disabled={busy}
                onClick={() => { chooseEffort(level.effort) }}
              >
                <span className={css.optionCopy}>
                  <span className={css.modelName}>{level.label}</span>
                  {level.description !== undefined && (
                    <span className={css.description}>{level.description}</span>
                  )}
                </span>
                <span className={css.check}>
                  {effectiveEffort === level.effort ? <IconCheckOutline16 /> : null}
                </span>
              </button>
            ))}
        </>
      )}
    </>
  )

  return (
    <div ref={rootRef} className={css.root} onKeyDown={onRootKeyDown} onBlur={onBlur}>
      <button
        ref={triggerRef}
        type="button"
        className={css.trigger}
        aria-label={triggerAria}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        title={triggerLabel}
        disabled={locked}
        onClick={() => {
          if (open) {
            close()
          } else {
            show()
          }
        }}
      >
        <ElevatorLabel value={modelLabel} className={css.triggerLabel} />
        {effortLabel !== undefined && <ElevatorLabel value={effortLabel} className={css.triggerEffort} />}
        <IconChevronDownOutline14 className={clsx(css.chevron, open && css.chevronOpen)} />
      </button>

      {phone ? (
        <BottomSheet
          open={open}
          onClose={() => { close(true) }}
          title={t('menu.aria')}
          closeLabel={t('menu.close')}
          bodyClassName={css.sheetBody}
        >
          {paneContent}
        </BottomSheet>
      ) : open ? (
        <div
          ref={menuRef}
          id={`${id}-menu`}
          className={css.menu}
          role="menu"
          aria-label={t('menu.aria')}
          aria-busy={state.status === 'loading' || busy}
          style={menuStyle}
        >
          {paneContent}
        </div>
      ) : null}
      {toast !== null && (
        <Toast
          key={toast.seq}
          text={toast.text}
          icon={<IconWarningOutline16 />}
          anchor={rootRef.current?.closest<HTMLElement>('[data-composer-card]') ?? null}
          onDone={() => { setToast(null) }}
        />
      )}
    </div>
  )
}
