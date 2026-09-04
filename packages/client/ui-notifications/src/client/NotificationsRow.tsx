/**
 * Notification-sounds preference row registered into the General section item
 * slot — the notifications feature owns its own settings surface. Master
 * opt-in switch first; the per-event sound pickers (with preview) show once
 * enabled. Selection follows the persisted preference.
 */
import clsx from 'clsx'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import {
  NOTIFICATION_SOUNDS,
  type NotificationSound,
} from '../notification-settings.ts'
import type { NotificationsKey } from './locales.ts'
import type { createNotificationsRowStore, NotificationsRowState } from './settings-store.ts'
import type { NotificationEventKind as EventKind } from './watcher.ts'
import css from './NotificationsRow.module.css'

/** Injected business face: preference writes and sound preview (t rides the standard locale seat). */
export interface NotificationsRowInjected {
  /** Switch the master opt-in. */
  setEnabled: (enabled: boolean) => void
  /** Assign one event kind's sound. */
  setSound: (kind: EventKind, sound: NotificationSound) => void
  /** Play one event kind's currently assigned sound. */
  preview: (kind: EventKind) => void
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type NotificationsRowComponentProps =
  PropsRuntime<'settings.general.item'> & PropsStore<ReturnType<typeof createNotificationsRowStore>>
  & PropsLocale<'settings.notifications'> & NotificationsRowInjected

/** Event picker rows in display order. */
const EVENTS: readonly { kind: EventKind; labelKey: NotificationsKey }[] = [
  { kind: 'done', labelKey: 'notifications.event.done' },
  { kind: 'attention', labelKey: 'notifications.event.attention' },
  { kind: 'error', labelKey: 'notifications.event.error' },
]

const SOUND_LABEL_KEYS: Record<NotificationSound, NotificationsKey> = {
  chime: 'notifications.sound.chime',
  ping: 'notifications.sound.ping',
  bell: 'notifications.sound.bell',
  pulse: 'notifications.sound.pulse',
}

/** The row store mirrors the snapshot flat (`doneSound`, …); pick the field an event kind names. */
function soundOf(state: NotificationsRowState, kind: EventKind): NotificationSound {
  return kind === 'done' ? state.doneSound : kind === 'attention' ? state.attentionSound : state.errorSound
}

/**
 * Render the notifications row.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export function NotificationsRow({
  t, useStore, setEnabled, setSound, preview,
}: NotificationsRowComponentProps) {
  const state = useStore(s => s)
  return (
    <div className={css.group}>
      <div className={css.head}>
        <span className={css.title}>{t('notifications.title')}</span>
        <button
          type="button"
          role="switch"
          aria-checked={state.enabled}
          aria-label={t('notifications.enable')}
          className={css.switch}
          onClick={() => {
            const next = !state.enabled
            setEnabled(next)
            if (next && typeof Notification !== 'undefined' && Notification.permission === 'default') {
              void Notification.requestPermission()
            }
          }}
        />
      </div>
      {state.enabled && EVENTS.map(({ kind, labelKey }) => (
        <div key={kind} className={css.eventRow}>
          <span className={css.eventLabel}>{t(labelKey)}</span>
          <div className={css.chipRow} role="group" aria-label={t(labelKey)}>
            {NOTIFICATION_SOUNDS.map(sound => (
              <button
                key={sound}
                type="button"
                className={clsx(css.chip, soundOf(state, kind) === sound && css.selected)}
                aria-pressed={soundOf(state, kind) === sound}
                onClick={() => { setSound(kind, sound) }}
              >
                {t(SOUND_LABEL_KEYS[sound])}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={css.preview}
            title={t('notifications.preview')}
            aria-label={t('notifications.preview')}
            onClick={() => { preview(kind) }}
          >
            ▶
          </button>
        </div>
      ))}
    </div>
  )
}
