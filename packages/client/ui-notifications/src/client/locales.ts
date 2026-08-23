/** `settings.notifications` namespace dictionaries (the notifications row's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'notifications.title': '通知音效',
  'notifications.enable': '完成或需要关注时播放提示音',
  'notifications.event.done': '任务完成',
  'notifications.event.attention': '需要确认',
  'notifications.event.error': '发生错误',
  'notifications.sound.chime': '风铃',
  'notifications.sound.ping': '叮声',
  'notifications.sound.bell': '铃铛',
  'notifications.sound.pulse': '脉冲',
  'notifications.preview': '试听',
} satisfies Record<string, string>

/** The settings.notifications namespace key union. */
export type NotificationsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'notifications.title': 'Notification sounds',
  'notifications.enable': 'Play a sound when work finishes or needs you',
  'notifications.event.done': 'Work finished',
  'notifications.event.attention': 'Needs your attention',
  'notifications.event.error': 'Error occurred',
  'notifications.sound.chime': 'Chime',
  'notifications.sound.ping': 'Ping',
  'notifications.sound.bell': 'Bell',
  'notifications.sound.pulse': 'Pulse',
  'notifications.preview': 'Preview',
} satisfies Record<NotificationsKey, string>
