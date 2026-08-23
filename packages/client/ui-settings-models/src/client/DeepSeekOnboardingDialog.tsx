/**
 * Official-DeepSeek first-run step. Readiness comes from the same
 * provider/settings/credential join as the Models page: any provider the user
 * can already talk to ends the step, and only a user with none is offered the
 * official DeepSeek route. The step reuses that page's credential editor in
 * the onboarding plugin's shared modal, so the key is entered once.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ModelsSettingsState, ModelsSettingsStore } from './store.ts'
import { onboardingReadiness } from './store.ts'
import type { SettingsSchemaOperations } from './schema-operations.ts'
import { ProviderEditor } from './ProviderEditor.tsx'
import type { en } from './locales.ts'
import { OnboardingModal } from './OnboardingModal.tsx'
import styles from './DeepSeekOnboardingDialog.module.css'

/** Registration-side dependencies of {@link DeepSeekOnboardingDialog}. */
export interface DeepSeekOnboardingInjected {
  hooks: {
    /** Shared Models-page join state, bound by the slot renderer. */
    models: SnapshotStore<ModelsSettingsState>
  }
  /** Shared Models-page join controller. */
  controller: ModelsSettingsStore
  /** Existing wire face reused by the Models credential editor. */
  api: Pick<IApiClient, 'settings' | 'credentials' | 'llm'>
  /** Settings schema and immutable path callbacks. */
  schema: SettingsSchemaOperations
  /** Ask ui-workspace's existing hero picker to start its directory-flow route. */
  requestWorkspace: (onSettled: (completed: boolean) => void) => boolean
  /** Feature copy. */
  t: (key: keyof typeof en) => string
}

/** Slot owner props plus the feature's injected dependencies. */
export type DeepSeekOnboardingDialogProps =
  PropsRuntime<'settings.onboarding'> & InjectFace<DeepSeekOnboardingInjected>

/* v8 ignore next 3 -- closed-union defaults only defend future source widening */
function assertNever(_value: never): never {
  throw new Error('unexpected DeepSeek onboarding state')
}

/**
 * Prompt a first-run user for the official DeepSeek credential while no
 * provider can serve requests and that credential is writable. Unrepairable
 * states stay explicit with a Models recovery action; a usable provider
 * continues through Workspace and first-task guidance.
 * @param props - settings-shell owner state and Models feature dependencies.
 * @returns the onboarding modal or null when onboarding needs no intervention.
 */
export function DeepSeekOnboardingDialog(props: DeepSeekOnboardingDialogProps): ReactNode {
  const {
    complete, openSection, controller, useModels, useWorkspaces, api, schema, requestWorkspace, t,
  } = props
  const state = useModels(snapshot => snapshot)
  const workspaces = useWorkspaces(snapshot => snapshot)
  const readiness = onboardingReadiness(state)
  const [workspaceError, setWorkspaceError] = useState(false)
  const [workspaceHandoff, setWorkspaceHandoff] = useState(false)
  const [showFirstTask, setShowFirstTask] = useState(false)

  useEffect(() => {
    if (state.status === 'idle') void controller.load()
  }, [controller, state.status])

  switch (readiness.kind) {
    case 'loading':
      return null
    case 'adapter-absent':
      return (
        <Recovery
          title={t('onboardingRecoveryTitle')}
          description={t('onboardingRecoveryAdapterAbsent')}
          actionLabel={t('onboardingOpenModels')}
          onAction={() => { openSection('models'); complete() }}
        />
      )
    case 'unavailable': {
      const recoveryKey = {
        'load-failed': 'onboardingRecoveryLoadFailed',
        'provider-inactive': 'onboardingRecoveryProviderInactive',
        'credentials-unavailable': 'onboardingRecoveryCredentialsUnavailable',
        'settings-read-only': 'onboardingRecoverySettingsReadOnly',
        'credential-read-only': 'onboardingRecoveryCredentialReadOnly',
      } as const
      return (
        <Recovery
          title={t('onboardingRecoveryTitle')}
          description={t(recoveryKey[readiness.reason])}
          actionLabel={t('onboardingOpenModels')}
          onAction={() => { openSection('models'); complete() }}
        />
      )
    }
    case 'provider-ready':
      if (workspaces.items.length === 0) {
        return (
          <Recovery
            title={t('onboardingWorkspaceTitle')}
            description={t('onboardingWorkspaceDescription')}
            actionLabel={t('onboardingChooseWorkspace')}
            secondaryActionLabel={t('onboardingSkipForNow')}
            error={workspaceError ? t('onboardingWorkspaceUnavailable') : undefined}
            actionsDisabled={workspaceHandoff}
            onSecondaryAction={complete}
            onAction={() => {
              if (!requestWorkspace((completed) => {
                setWorkspaceHandoff(false)
                setShowFirstTask(completed)
              })) {
                setWorkspaceError(true)
                return
              }
              setWorkspaceHandoff(true)
            }}
          />
        )
      }
      if (!showFirstTask) return null
      return (
        <Recovery
          title={t('onboardingTaskTitle')}
          description={t('onboardingTaskDescription')}
          actionLabel={t('onboardingStartTask')}
          secondaryActionLabel={t('onboardingSkipForNow')}
          onAction={complete}
          onSecondaryAction={complete}
        />
      )
    case 'credential-missing':
      break
    /* v8 ignore next -- every current readiness variant is handled above */
    default:
      return assertNever(readiness)
  }

  const row = state.rows.find(candidate =>
    candidate.entry.provider === 'deepseek-official'
    && candidate.entry.settingsNs === 'llm-deepseek'
    && candidate.entry.settingsPath.length === 0)
  const namespace = state.namespaces.get('llm-deepseek')
  /* v8 ignore next 2 -- credential-missing is derived only from this exact joined row. */
  if (row === undefined || namespace === undefined) return null

  const finishCredential = (changed: boolean): void => {
    if (!changed) {
      complete()
      return
    }
    void controller.load()
  }

  return (
    <OnboardingModal title={t('onboardingTitle')}>
      <p className={styles.description}>{t('onboardingDescription')}</p>
      <div className={styles.editor}>
        <ProviderEditor
          provider={row.entry.provider}
          displayName={row.entry.displayName}
          namespace={namespace}
          schema={schema}
          settingsPath={row.entry.settingsPath}
          api={api}
          t={t}
          readOnly={false}
          hideTitle
          credentialOnly
          credentialRequired
          autoFocusCredential
          cancelLabel="onboardingLater"
          submitLabel="onboardingSave"
          submitBusyLabel="onboardingSaving"
          onClose={finishCredential}
        />
      </div>
      <div className={styles.actions}>
        <Button variant="outline" onClick={() => { openSection('models'); complete() }}>
          {t('onboardingOpenModels')}
        </Button>
      </div>
    </OnboardingModal>
  )
}

/** Compact non-destructive recovery or handoff step in the first-run journey. */
function Recovery({
  title, description, actionLabel, secondaryActionLabel, error, actionsDisabled = false, onAction, onSecondaryAction,
}: {
  title: string
  description: string
  actionLabel: string
  secondaryActionLabel?: string | undefined
  error?: string | undefined
  actionsDisabled?: boolean | undefined
  onAction: () => void
  onSecondaryAction?: (() => void) | undefined
}): ReactNode {
  return (
    <OnboardingModal title={title} focusTitle>
      <p className={styles.description}>{description}</p>
      {error === undefined ? null : <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.actions}>
        <Button variant="primary" disabled={actionsDisabled} onClick={onAction}>{actionLabel}</Button>
        {secondaryActionLabel === undefined || onSecondaryAction === undefined
          ? null
          : <Button variant="outline" disabled={actionsDisabled} onClick={onSecondaryAction}>{secondaryActionLabel}</Button>}
      </div>
    </OnboardingModal>
  )
}
