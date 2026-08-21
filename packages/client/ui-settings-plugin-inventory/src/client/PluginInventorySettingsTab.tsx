import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import type { PluginInventorySnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import {
  IconChevronDownOutline14,
  IconSearchOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PluginInventoryLocaleKey } from './locales.ts'
import css from './PluginInventorySettingsTab.module.css'

/** Registration-side Remote face used by the section. */
export interface PluginInventorySettingsTabInjected {
  /** Read a current Host inventory snapshot. */
  list: () => Promise<PluginInventorySnapshot>
}

type PluginInventoryEntry = PluginInventorySnapshot['entries'][number]
type PluginFiberPhase = PluginInventoryEntry['fiberPhase']

/** One repository returned by the GitHub `dsh-plugin` topic search. */
export interface DiscoveredPlugin {
  readonly archived: boolean
  readonly full_name: string
  readonly html_url: string
  readonly description: string | null
  readonly stargazers_count: number
  readonly language: string | null
}

/** GitHub repository-search payload; only fields this tab consumes are typed. */
interface GitHubSearchResponse {
  readonly items: readonly DiscoveredPlugin[]
}

/** GitHub search query for the topic, newest 100 by stars. */
const GITHUB_TOPIC_URL =
  'https://api.github.com/search/repositories?q=topic:dsh-plugin&sort=stars&order=desc&per_page=100'

/** Full component props assembled by the Settings slot renderer. */
export type PluginInventorySettingsTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.pluginInventory'>
  & InjectFace<PluginInventorySettingsTabInjected>

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly snapshot: PluginInventorySnapshot }

type DiscoverState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly repos: readonly DiscoveredPlugin[] }

type View = 'installed' | 'discover'

const PHASE_KEYS = {
  pending: 'pending',
  loading: 'loadingPhase',
  active: 'active',
  failed: 'failed',
  unloading: 'unloading',
} satisfies Record<Exclude<PluginFiberPhase, null>, PluginInventoryLocaleKey>

/** Localized accessible label for one root Fiber phase. */
function phaseLabel(
  phase: PluginFiberPhase,
  t: PluginInventorySettingsTabProps['t'],
): string {
  return phase === null ? t('unobserved') : t(PHASE_KEYS[phase])
}

/** Compact a module specifier without guessing whether its Loader id was generated. */
function moduleShortName(moduleName: string): string {
  const unscoped = moduleName.startsWith('@') ? moduleName.slice(moduleName.indexOf('/') + 1) : moduleName
  return unscoped
    .replace(/^cordis:/, '')
    .replace(/^cordis-plugin-/, '')
    .replace(/^dsh-(?:host-|client-)?/, '')
}

/** Whether an inventory row matches the local catalog query. */
function matches(entry: PluginInventoryEntry, normalizedQuery: string): boolean {
  if (normalizedQuery.length === 0) return true
  return [entry.moduleName, entry.entryId]
    .some(value => value.toLocaleLowerCase().includes(normalizedQuery))
}

/** Whether a discovered repository matches the local catalog query. */
function matchesDiscovered(repo: DiscoveredPlugin, normalizedQuery: string): boolean {
  if (normalizedQuery.length === 0) return true
  return [repo.full_name, repo.description ?? '']
    .some(value => value.toLocaleLowerCase().includes(normalizedQuery))
}

/** Sort repositories by star count, highest first. */
function byStarsDescending(a: DiscoveredPlugin, b: DiscoveredPlugin): number {
  return b.stargazers_count - a.stargazers_count
}

/** Decorative star glyph in front of a star count. */
function StarGlyph(): ReactNode {
  return (
    <svg className={css.starGlyph} viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path
        d="M8 1.4l2 4.1 4.5.7-3.3 3.2.8 4.5L8 11.6l-4 2.3.8-4.5L1.5 6.2 6 5.5l2-4.1z"
        fill="currentColor"
      />
    </svg>
  )
}

/** Render the current Loader inventory or browse the GitHub `dsh-plugin` topic. */
export function PluginInventorySettingsTab({ list, t }: PluginInventorySettingsTabProps): ReactNode {
  const catalogId = useId()
  const [view, setView] = useState<View>('installed')
  const [request, setRequest] = useState(0)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<PluginInventoryEntry['entryId'] | null>(null)
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const [discoverRequest, setDiscoverRequest] = useState(0)
  const [discoverState, setDiscoverState] = useState<DiscoverState>({ status: 'loading' })

  useEffect(() => {
    let current = true
    void Promise.resolve().then(() => list()).then(
      (snapshot) => { if (current) setState({ status: 'ready', snapshot }) },
      () => { if (current) setState({ status: 'error' }) },
    )
    return () => { current = false }
  }, [list, request])

  useEffect(() => {
    if (view !== 'discover') return
    let current = true
    setDiscoverState({ status: 'loading' })
    void fetch(GITHUB_TOPIC_URL).then(
      (response) => {
        if (!response.ok) throw new Error(`github search failed with ${response.status}`)
        return response.json() as Promise<GitHubSearchResponse>
      },
    ).then(
      (payload) => {
        if (!current) return
        const repos = [...payload.items]
          .filter(repo => !repo.archived)
          .sort(byStarsDescending)
        setDiscoverState({ status: 'ready', repos })
      },
      () => { if (current) setDiscoverState({ status: 'error' }) },
    )
    return () => { current = false }
  }, [view, discoverRequest])

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filteredEntries = useMemo(
    () => state.status === 'ready'
      ? state.snapshot.entries.filter(entry => matches(entry, normalizedQuery))
      : [],
    [normalizedQuery, state],
  )
  const filteredDiscovered = useMemo(
    () => discoverState.status === 'ready'
      ? discoverState.repos.filter(repo => matchesDiscovered(repo, normalizedQuery))
      : [],
    [normalizedQuery, discoverState],
  )

  useEffect(() => {
    if (expanded !== null && !filteredEntries.some(entry => entry.entryId === expanded)) {
      setExpanded(null)
    }
  }, [expanded, filteredEntries])

  const retry = (): void => {
    setState({ status: 'loading' })
    setRequest(value => value + 1)
  }

  const discoverRetry = (): void => {
    setDiscoverRequest(value => value + 1)
  }

  const switchView = (next: View): void => {
    setView(next)
    setQuery('')
  }

  return (
    <div
      className={css.section}
      aria-busy={view === 'installed' ? state.status === 'loading' : discoverState.status === 'loading'}
    >
      <div className={css.views} role="group" aria-label={t('tab')}>
        <button
          className={css.viewButton}
          type="button"
          aria-pressed={view === 'installed'}
          data-active={view === 'installed' ? 'true' : undefined}
          onClick={() => { switchView('installed') }}
        >
          {t('viewInstalled')}
        </button>
        <button
          className={css.viewButton}
          type="button"
          aria-pressed={view === 'discover'}
          data-active={view === 'discover' ? 'true' : undefined}
          onClick={() => { switchView('discover') }}
        >
          {t('viewDiscover')}
        </button>
      </div>
      {view === 'installed' ? (
        <>
          {state.status === 'loading' ? <p className={css.status}>{t('loading')}</p> : null}
          {state.status === 'error' ? (
            <div className={css.failure}>
              <p role="alert">{t('error')}</p>
              <button type="button" onClick={retry}>{t('retry')}</button>
            </div>
          ) : null}
          {state.status === 'ready' ? (
            <div className={css.catalog}>
              <label className={css.search}>
                <IconSearchOutline16 aria-hidden="true" />
                <span className={css.visuallyHidden}>{t('search')}</span>
                <input
                  type="search"
                  value={query}
                  placeholder={t('search')}
                  aria-label={t('search')}
                  onChange={(event) => { setQuery(event.currentTarget.value) }}
                />
              </label>
              <div className={css.catalogHeading}>
                <h3>{t('catalog')}</h3>
                <span data-plugin-count={filteredEntries.length}>{filteredEntries.length}</span>
              </div>
              {state.snapshot.entries.length === 0 ? <p className={css.status}>{t('empty')}</p> : null}
              {state.snapshot.entries.length > 0 && filteredEntries.length === 0
                ? <p className={css.status}>{t('emptySearch')}</p>
                : null}
              {filteredEntries.length > 0 ? (
                <ul className={css.cards}>
                  {filteredEntries.map((entry) => {
                    const status = phaseLabel(entry.fiberPhase, t)
                    const title = moduleShortName(entry.moduleName)
                    const configuration = t(entry.enabled ? 'enabledTag' : 'disabledTag')
                    const open = expanded === entry.entryId
                    const detailId = `${catalogId}-details-${encodeURIComponent(entry.entryId)}`
                    return (
                      <li
                        className={css.card}
                        key={entry.entryId}
                        data-plugin-entry={entry.entryId}
                        data-open={open ? 'true' : undefined}
                      >
                        <button
                          className={css.cardContent}
                          type="button"
                          aria-expanded={open}
                          aria-controls={detailId}
                          aria-label={entry.enabled ? `${title}, ${status}, ${configuration}` : `${title}, ${configuration}`}
                          onClick={() => {
                            setExpanded(current => current === entry.entryId ? null : entry.entryId)
                          }}
                        >
                          <strong className={css.cardTitle} title={entry.moduleName}>{title}</strong>
                          <span className={css.cardTrailing}>
                            {entry.enabled ? (
                              <span
                                className={css.statusDot}
                                data-phase={entry.fiberPhase ?? 'unobserved'}
                                role="img"
                                aria-label={status}
                                title={status}
                              />
                            ) : null}
                            <span className={css.configTag} data-enabled={entry.enabled ? 'true' : 'false'}>
                              {configuration}
                            </span>
                            <IconChevronDownOutline14 className={css.chevron} size={12} aria-hidden="true" />
                          </span>
                        </button>
                        {open ? (
                          <div className={css.cardDetails} id={detailId}>
                            <code className={css.entryValue} data-loader-entry>{entry.entryId}</code>
                            <dl className={css.details}>
                              <div>
                                <dt>{t('configuration')}</dt>
                                <dd>{configuration}</dd>
                              </div>
                              {entry.enabled ? (
                                <div>
                                  <dt>{t('cordis')}</dt>
                                  <dd>{status}</dd>
                                </div>
                              ) : null}
                            </dl>
                          </div>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              ) : null}
            </div>
          ) : null}
        </>
      ) : (
        <div className={css.catalog}>
          <label className={css.search}>
            <IconSearchOutline16 aria-hidden="true" />
            <span className={css.visuallyHidden}>{t('search')}</span>
            <input
              type="search"
              value={query}
              placeholder={t('search')}
              aria-label={t('search')}
              onChange={(event) => { setQuery(event.currentTarget.value) }}
            />
          </label>
          <div className={css.catalogHeading}>
            <h3>{t('discoverHeading')}</h3>
            <span data-plugin-count={filteredDiscovered.length}>{filteredDiscovered.length}</span>
          </div>
          {discoverState.status === 'loading' ? <p className={css.status}>{t('discoverLoading')}</p> : null}
          {discoverState.status === 'error' ? (
            <div className={css.failure}>
              <p role="alert">{t('discoverError')}</p>
              <button type="button" onClick={discoverRetry}>{t('retry')}</button>
            </div>
          ) : null}
          {discoverState.status === 'ready' ? (
            <>
              {discoverState.repos.length === 0 ? <p className={css.status}>{t('discoverEmpty')}</p> : null}
              {discoverState.repos.length > 0 && filteredDiscovered.length === 0
                ? <p className={css.status}>{t('discoverNoResults')}</p>
                : null}
              {filteredDiscovered.length > 0 ? (
                <ul className={css.cards}>
                  {filteredDiscovered.map(repo => (
                    <li className={css.card} key={repo.full_name}>
                      <a
                        className={css.repoLink}
                        href={repo.html_url}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`${repo.full_name}, ${repo.stargazers_count} ${t('discoverStars')}`}
                      >
                        <strong className={css.cardTitle}>{repo.full_name}</strong>
                        {repo.description !== null && repo.description !== ''
                          ? <span className={css.repoDescription}>{repo.description}</span>
                          : null}
                        <span className={css.repoMeta}>
                          <span
                            className={css.stars}
                            title={`${repo.stargazers_count.toLocaleString()} ${t('discoverStars')}`}
                          >
                            <StarGlyph />
                            {repo.stargazers_count.toLocaleString()}
                          </span>
                          {repo.language !== null && repo.language !== ''
                            ? <span className={css.lang}>{repo.language}</span>
                            : null}
                          <span className={css.repoLinkHint}>{t('discoverLink')} ↗</span>
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : null}
        </div>
      )}
    </div>
  )
}
