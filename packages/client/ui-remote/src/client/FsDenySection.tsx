import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Button, SectionHeading } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import css from './FsDenySection.module.css'

/** The fs-deny settings section value. */
export interface FsDenySettings {
  patterns: readonly string[]
}

/** Registration-side inject face consumed by this section. */
export interface FsDenySectionInjected {
  /** Bound settings scope for the fs-deny namespace. */
  settingsScope: SettingsScope<FsDenySettings>
  /** Whether the connection is to loopback host (false when remote). */
  isLoopback?: boolean | undefined
}

/** Section component props assembled by the slot renderer. */
export type FsDenySectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.remote'>
  & InjectFace<FsDenySectionInjected>

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

/**
 * The Access restrictions settings section: a textarea where the user enters
 * one deny pattern per line. Saving writes the `patterns` field through the
 * settings scope (the host fs-deny policy reads the same namespace).
 */
export function FsDenySection(props: FsDenySectionProps): ReactNode {
  const { t, isLoopback } = props
  if (isLoopback === false) {
    return (
      <div className={css.section}>
        <SectionHeading title={t('fsDenyHeading')} description={t('fsDenyHint')} />
        <div className={css.remoteNotice}>
          <p className={css.remoteNoticeTitle}>{t('configureInWebGuiTitle')}</p>
          <p className={css.remoteNoticeDescription}>{t('fsDenyRemoteDescription')}</p>
        </div>
      </div>
    )
  }
  return <FsDenySectionContent {...props} />
}

function FsDenySectionContent({ t, settingsScope }: FsDenySectionProps): ReactNode {
  const [text, setText] = useState<string>('')
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [initialText, setInitialText] = useState<string>('')

  // Load the current patterns on mount and on snapshot changes.
  useEffect(() => {
    const snapshot = settingsScope.getSnapshot()
    const joined = (snapshot.value?.patterns ?? []).join('\n')
    setText(joined)
    setInitialText(joined)
  }, [settingsScope])

  const handleSave = useCallback(async (): Promise<void> => {
    const patterns = text.split('\n').map(l => l.trim()).filter(l => l.length > 0)
    setSaveState('saving')
    try {
      await settingsScope.set('patterns', patterns)
      setInitialText(text)
      setSaveState('saved')
      setTimeout(() => { setSaveState('idle') }, 2000)
    } catch {
      setSaveState('error')
    }
  }, [text, settingsScope])

  const handleDiscard = useCallback((): void => {
    setText(initialText)
    setSaveState('idle')
  }, [initialText])

  const changed = text !== initialText

  return (
    <div className={css.section}>
      <SectionHeading title={t('fsDenyHeading')} description={t('fsDenyHint')} />
      <div className={css.group}>
        <textarea
          className={css.textarea}
          value={text}
          onChange={(e) => { setText(e.target.value); setSaveState('idle') }}
          rows={8}
          placeholder={t('fsDenyPlaceholder')}
          spellCheck={false}
        />
        <div className={css.actions}>
          <Button onClick={() => { void handleSave() }} disabled={!changed || saveState === 'saving'}>
            {saveState === 'saving' ? t('fsDenySaving') : t('fsDenySave')}
          </Button>
          {changed && (
            <Button onClick={handleDiscard}>{t('fsDenyDiscard')}</Button>
          )}
          {saveState === 'saved' && <span className={css.status}>{t('fsDenySaved')}</span>}
          {saveState === 'error' && <span className={css.status}>{t('fsDenyError')}</span>}
        </div>
      </div>
    </div>
  )
}
