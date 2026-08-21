/**
 * The About settings section: the host installation's identity (version,
 * surface, git branch/commit/remote) plus its update state — manual check,
 * one-click apply, and the restart progress. Repository facts ride the shared
 * describe mirror; update phases ride the shared UpdateStore.
 */

import type { ReactNode } from 'react'
import { Button, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { HostDescription } from '@deepseek-ai/dsh-api-remotes/client'
import type { UpdateStore } from './update-store.ts'
import css from './AboutSection.module.css'

/** Registrant-owned dependencies of {@link AboutSection}. */
export interface AboutSectionInjected {
  /** Shared update-state owner (check/apply phases). */
  controller: UpdateStore
  hooks: {
    /** Controller snapshot bound by the UI renderer as useSnapshot. */
    snapshot: UpdateStore['store']
    /** Shared describe mirror bound as useDescribe (identity facts source). */
    describe: {
      getSnapshot(): HostDescription | undefined
      subscribe(listener: () => void): () => void
    }
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
export function AboutSection({ controller, useDescribe, useSnapshot, t }: AboutSectionProps): ReactNode {
  const description = useDescribe(snapshot => snapshot)
  const state = useSnapshot(snapshot => snapshot)

  if (description === undefined) {
    return <div className={css.section}><p className={css.note}>{t('about.offline')}</p></div>
  }

  const repository = description.repository
  const shortCommit = repository === null ? null : repository.commit.slice(0, 7)
  const busy = state.phase === 'applying' || state.phase === 'restarting'

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

      <div className={css.update}>
        <div className={css.updateHead}>
          <span className={css.updateTitle}>{t('about.updates')}</span>
          {busy && <StateDot state="ongoing" />}
        </div>
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
      </div>
    </div>
  )
}
