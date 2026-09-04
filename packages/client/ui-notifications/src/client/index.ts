/**
 * Browser notifications plugin: owns the durable opt-in preference and the
 * session-state watcher that plays its sounds, and registers the
 * notification-sounds preference row into the settings General section — the
 * feature owns its own settings surface.
 */
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: the ctx.settingsScope Context merge. Cross-plugin collaboration
// goes through the service, never a value import (client bundle purity gate).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import {
  NOTIFICATION_SETTINGS_NAMESPACE,
  type NotificationSettings,
} from '../notification-settings.ts'
import {
  defaultNotificationPresenter,
  NotificationRuntime,
  openSessionSafely,
  type NotificationSnapshot,
  type NotificationTranslator,
} from './runtime.ts'
import { NotificationsRow, type NotificationsRowInjected } from './NotificationsRow.tsx'
import { createNotificationsRowStore } from './settings-store.ts'
import { createWebAudioPlayer } from './sounds.ts'
import { en, zh, type NotificationsKey } from './locales.ts'

export type { NotificationsRowComponentProps, NotificationsRowInjected } from './NotificationsRow.tsx'
export type { NotificationPresenter, NotificationSnapshot, NotificationTranslator } from './runtime.ts'
export type { NotificationsKey } from './locales.ts'
export type { NotificationSettings, NotificationSound } from '../notification-settings.ts'
export { defaultNotificationPresenter, openSessionSafely } from './runtime.ts'

/** Namespace owning this feature's settings-row copy. */
export const SETTINGS_NS = 'settings.notifications'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The notifications settings row's copy. */
    'settings.notifications': NotificationsKey
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The notifications preference service (provided by this plugin). */
    notifications: NotificationRuntime
  }
  interface Events {
    /**
     * Preference state changed (row write or Host adoption).
     * @param snapshot - Current immutable preference snapshot.
     * @mode emit
     */
    'notifications/change'(snapshot: NotificationSnapshot): void
  }
}

/**
 * Required services: sessions (the watched list snapshot), settings transport
 * plus slots/locale for the row. `remote` carries the forwarded settings
 * invalidation that `ctx.settingsScope.bind(spec)` subscribes to on this
 * context.
 */
export const inject = ['slots', 'sessions', 'locale', 'connection', 'remote', 'settingsScope']

/**
 * Client plugin body: provide the notifications service and register the
 * feature-owned preference row into the General section's item slot.
 * @param ctx - client cordis context.
 */
export function apply(ctx: ClientContext): void {
  const host = ctx.settingsScope.bind<NotificationSettings>({ namespace: NOTIFICATION_SETTINGS_NAMESPACE })
  const t = ctx.locale.bind(SETTINGS_NS)
  const translator: NotificationTranslator = { t: (key: string) => t(key as NotificationsKey) }
  const presenter = defaultNotificationPresenter(ctx.sessions, translator)
  const notifications = new NotificationRuntime(ctx, host, ctx.sessions, createWebAudioPlayer(), presenter)
  ctx.provide('notifications', notifications)

  ctx.effect(() => ctx.locale.register(SETTINGS_NS, { zh, en }), 'ui-notifications: settings row dictionaries')

  if (typeof window !== 'undefined') {
    ctx.effect(() => {
      const onMessage = (event: MessageEvent<unknown>): void => {
        const value = event.data
        if (typeof value !== 'object' || value === null) return
        const message = value as Record<string, unknown>
        if (message.type !== 'dsh/open-session' || message.version !== 1 || typeof message.sessionId !== 'string') return
        openSessionSafely(ctx.sessions, message.sessionId as SessionId)
      }
      window.addEventListener('message', onMessage)
      return () => { window.removeEventListener('message', onMessage) }
    }, 'ui-notifications: shell open-session message')
  }

  const store = createNotificationsRowStore()
  let bound: BoundActions<typeof store> | undefined
  const sync = (snapshot: NotificationSnapshot): void => {
    bound?.sync(snapshot)
  }
  ctx.on('notifications/change', sync)
  const injected = (actions: BoundActions<typeof store>): NotificationsRowInjected => {
    bound = actions
    // Re-sync from the getter so no event is lost between registration and
    // first render (the store's revision guard drops stale duplicates).
    sync(notifications.getSnapshot())
    return {
      setEnabled: (enabled) => { notifications.setEnabled(enabled) },
      setSound: (kind, sound) => { notifications.setSound(kind, sound) },
      preview: (kind) => { notifications.preview(kind) },
    }
  }
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'notifications',
    order: 11,
    store,
    locale: SETTINGS_NS,
    inject: injected,
  }, NotificationsRow))
}
