/** Notification-sound preferences stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Built-in synthesized sounds accepted at the registry and settings boundaries. */
export const NOTIFICATION_SOUNDS = ['chime', 'ping', 'bell', 'pulse'] as const

/** Settings namespace owned by the notification plugin. */
export const NOTIFICATION_SETTINGS_NAMESPACE = 'ui-notifications'

/** Field carrying the master opt-in switch. */
export const ENABLED_FIELD = 'enabled'

/** Field carrying the sound played when a session finishes its run. */
export const DONE_SOUND_FIELD = 'doneSound'
/** Field carrying the sound played when a session starts blocking on this user. */
export const ATTENTION_SOUND_FIELD = 'attentionSound'
/** Field carrying the sound played when a session's turn ends in a terminal failure. */
export const ERROR_SOUND_FIELD = 'errorSound'

/** One built-in sound id. */
export type NotificationSound = typeof NOTIFICATION_SOUNDS[number]

/** Defaults when the user-settings document has no override. The feature is opt-in: sounds stay off until enabled. */
export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: false,
  doneSound: 'chime',
  attentionSound: 'bell',
  errorSound: 'pulse',
}

/** Durable notification section shared by the Host schema and the browser scope. */
export interface NotificationSettings {
  /** Master opt-in; false keeps every watcher transition silent. */
  enabled: boolean
  /** Sound for the "work finished" event. */
  doneSound: NotificationSound
  /** Sound for the "needs your attention" event. */
  attentionSound: NotificationSound
  /** Sound for the "error occurred" event. */
  errorSound: NotificationSound
}

/** Durable notification schema; also the wire envelope the browser scope validates against. */
export const NotificationSettingsSchema: z<NotificationSettings> = z.object({
  [ENABLED_FIELD]: z.boolean().default(false),
  [DONE_SOUND_FIELD]: z.union([...NOTIFICATION_SOUNDS]).default('chime'),
  [ATTENTION_SOUND_FIELD]: z.union([...NOTIFICATION_SOUNDS]).default('bell'),
  [ERROR_SOUND_FIELD]: z.union([...NOTIFICATION_SOUNDS]).default('pulse'),
})

/**
 * Narrow one wire or registry value to a persistable sound id.
 * @param value - value crossing the settings or registry boundary.
 * @returns whether the value is a built-in sound id.
 */
export function isNotificationSound(value: unknown): value is NotificationSound {
  return NOTIFICATION_SOUNDS.some(sound => sound === value)
}
