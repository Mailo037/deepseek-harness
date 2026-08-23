/**
 * The About settings section: the host installation's identity (version,
 * surface, git branch/commit/remote) plus its update state — manual check,
 * one-click apply, and the restart progress. Repository facts ride the shared
 * describe mirror; update phases ride the shared UpdateStore.
 */

import { useId, type ReactNode } from 'react'
import {
  Button, ComparisonRail, LabeledField, Select, StateDot, SurfaceCard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { HostDescription } from '@deepseek-ai/dsh-api-remotes/client'
import type { UpdateStore } from './update-store.ts'
import {
  HARNESS_UPDATE_SOURCES, type HarnessSyncStore,
} from './harness-sync-store.ts'
import css from './AboutSection.module.css'

/** Registrant-owned dependencies of {@link AboutSection}. */
export interface AboutSectionInjected {
  /** Shared update-state owner (check/apply phases). */
  controller: UpdateStore
  /** AI-assisted Harness update session owner. */
  syncController: HarnessSyncStore
  hooks: {
    /** Controller snapshot bound by the UI renderer as useSnapshot. */
    snapshot: UpdateStore['store']
    /** Shared describe mirror bound as useDescribe (identity facts source). */
    describe: {
      getSnapshot(): HostDescription | undefined
      subscribe(listener: () => void): () => void
    }
    /** AI-assisted update snapshot bound by the UI renderer. */
    syncSnapshot: HarnessSyncStore['store']
  }
}

/** Section owner share, localized copy, and the injected faces. */
export type AboutSectionProps =
  PropsRuntime<'settings.section'> & PropsLocale<'settings'> & InjectFace<AboutSectionInjected>

/** One label/value row of the identity list. */
function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className={css.row}>
      <span className={css.rowLabel}>{label}</span>
      <span className={css.rowValue}>{value}</span>
    </div>
  )
}

/**
 * Render the About section content column.
 * @param props - section owner props, localized copy, and injected faces.
 * @returns the section element tree.
 */
export function AboutSection({
  close,
  controller,
  syncController,
  useDescribe,
  useSyncSnapshot,
  useSessions,
  useSnapshot,
  useWorkspaces,
  t,
}: AboutSectionProps): ReactNode {
  const description = useDescribe(snapshot => snapshot)
  const state = useSnapshot(snapshot => snapshot)
  const sync = useSyncSnapshot(snapshot => snapshot)
  const sessions = useSessions(snapshot => snapshot)
  const workspaces = useWorkspaces(snapshot => snapshot)
  const sourceId = useId()
  const modelId = useId()

  if (description === undefined) {
    return <div className={css.section}><p className={css.note}>{t('about.offline')}</p></div>
  }

  const repository = description.repository
  const shortCommit = repository === null ? null : repository.commit.slice(0, 7)
  const busy = state.phase === 'applying' || state.phase === 'restarting'
  const currentSession = sessions.current === undefined ? undefined : sessions.byId[sessions.current]
  const targetWorkspace = workspaces.items.find(workspace =>
    sessions.current !== undefined && workspace.sessionIds.includes(sessions.current))
    ?? workspaces.items.find(workspace => workspace.path === currentSession?.cwd)
    ?? workspaces.items.find(workspace => workspace.path === description.cwd)
    ?? workspaces.items.find(workspace => workspace.workspaceId === workspaces.recentWorkspaceId)
  const syncBusy = sync.phase === 'preparing' || sync.phase === 'starting'
  const updateSource = sync.source === 'unofficial' ? HARNESS_UPDATE_SOURCES[0] : HARNESS_UPDATE_SOURCES[1]
  const sourceLabel = sync.source === 'unofficial'
    ? t('about.aiUpdate.source.unofficial')
    : t('about.aiUpdate.source.official')
  const sourceOptions = [
    { value: 'unofficial', label: t('about.aiUpdate.source.unofficial') },
    { value: 'official', label: t('about.aiUpdate.source.official') },
  ]
  const modelOptions = sync.models.map(model => ({
    value: model.id,
    label: `${model.group} · ${model.label}`,
  }))

  return (
    <div className={css.section}>
      <div className={css.group}>
        <Row label={t('about.version')} value={description.version} />
        <Row
          label={t('about.surface')}
          value={description.surface === 'electron' ? t('about.surface.electron') : t('about.surface.web')}
        />
        {repository !== null && (
          <>
            <Row label={t('about.branch')} value={repository.branch} />
            {shortCommit !== null && <Row label={t('about.commit')} value={<code className={css.code}>{shortCommit}</code>} />}
            {repository.remoteUrl !== null && (
              <Row label={t('about.repository')} value={<span className={css.remote}>{repository.remoteUrl}</span>} />
            )}
          </>
        )}
      </div>

      <SurfaceCard title={t('about.updates')} status={busy ? <StateDot state="ongoing" /> : undefined}>
        {repository === null
          ? (
            <p className={css.note}>{t('about.noRepository')}</p>
          )
          : !description.canRestart
            ? (
              <p className={css.note}>{t('about.noRestart')}</p>
            )
            : (
              <>
                {state.phase === 'restarting' && <p className={css.note}>{t('about.restarting')}</p>}
                {state.phase === 'applying' && <p className={css.note}>{t('about.applying')}</p>}
                {state.phase === 'available' && state.check !== null && (
                  <p className={css.note}>
                    {t('about.available', { behind: String(state.check.behind) })}
                    {state.check.latest !== null && (
                      <span className={css.subject}> — {state.check.latest.subject}</span>
                    )}
                  </p>
                )}
                {state.phase === 'up-to-date' && <p className={css.note}>{t('about.upToDate')}</p>}
                {state.phase === 'checking' && <p className={css.note}>{t('about.checking')}</p>}
                {state.error !== null && <p className={css.error} role="alert">{state.error}</p>}
                <div className={css.actions}>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || state.phase === 'checking'}
                    onClick={() => { void controller.check(true) }}
                  >
                    {t('about.check')}
                  </Button>
                  {state.phase === 'available' && (
                    <Button variant="primary" size="sm" disabled={busy} onClick={() => { void controller.apply() }}>
                      {t('about.apply')}
                    </Button>
                  )}
                </div>
              </>
            )}
      </SurfaceCard>

      <SurfaceCard
        id="harness-update-card"
        title={t('about.aiUpdate.title')}
        status={syncBusy ? <StateDot state="ongoing" /> : undefined}
      >
        <ComparisonRail from={t('about.aiUpdate.local')} to={sourceLabel} />
        <p className={css.note}>{t('about.aiUpdate.description')}</p>
        <p className={css.note}>{t('about.aiUpdate.optional')}</p>
        <LabeledField label={t('about.aiUpdate.source')} labelFor={sourceId}>
          <Select
            id={sourceId}
            value={sync.source}
            options={sourceOptions}
            disabled={syncBusy}
            size="sm"
            onChange={(value) => {
              const source = HARNESS_UPDATE_SOURCES.find(candidate => candidate.id === value)
              if (source !== undefined) syncController.selectSource(source.id)
            }}
          />
        </LabeledField>
        <a
          className={css.sourceLink}
          href={updateSource.repository}
          target="_blank"
          rel="noreferrer"
        >
          {sync.source === 'unofficial' ? 'Mailo037/deepseek-harness' : 'deepseek-ai/deepseek-harness'}
        </a>
        {targetWorkspace === undefined
          ? <p className={css.note}>{t('about.aiUpdate.noWorkspace')}</p>
          : (
            <LabeledField label={t('about.aiUpdate.target')}>
              <code className={css.targetPath}>{targetWorkspace.path}</code>
            </LabeledField>
          )}
        {sync.phase === 'preparing' && <p className={css.note}>{t('about.aiUpdate.preparing')}</p>}
        {sync.phase === 'starting' && <p className={css.note}>{t('about.aiUpdate.starting')}</p>}
        {sync.error !== null && <p className={css.error} role="alert">{sync.error}</p>}
        {sync.phase === 'ready' && (
          <LabeledField label={t('about.aiUpdate.model')} labelFor={modelId}>
            <Select
              id={modelId}
              value={sync.selectedModelId ?? ''}
              options={modelOptions}
              size="sm"
              onChange={(value) => { syncController.selectModel(value) }}
            />
          </LabeledField>
        )}
        <div className={css.actions}>
          {sync.phase !== 'ready'
            ? (
              <Button
                variant="outline"
                size="sm"
                disabled={syncBusy || targetWorkspace === undefined}
                onClick={() => {
                  if (targetWorkspace !== undefined) {
                    void syncController.prepare(targetWorkspace.workspaceId, targetWorkspace.path)
                  }
                }}
              >
                {t('about.aiUpdate.prepare')}
              </Button>
            )
            : (
              <Button
                variant="primary"
                size="sm"
                disabled={syncBusy || sync.selectedModelId === null}
                onClick={() => {
                  void syncController.start().then((started) => { if (started) close() })
                }}
              >
                {t('about.aiUpdate.start')}
              </Button>
            )}
        </div>
      </SurfaceCard>
    </div>
  )
}
