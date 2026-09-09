/** `settings.notifications` namespace dictionaries (the notifications row's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'notifications.title': '通知音效',
  'notifications.enable': '完成或需要关注时发送通知与提示音',
  'notifications.browser.granted': '浏览器通知：已允许',
  'notifications.browser.default': '浏览器通知：尚未询问',
  'notifications.browser.request': '申请权限',
  'notifications.browser.denied': '浏览器通知：已被浏览器阻止',
  'notifications.browser.deniedHint': '请在浏览器为本站点允许通知（地址栏的站点权限设置），然后刷新本页。',
  'notifications.browser.unsupported': '当前浏览器不支持系统通知',
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
  'notifications.enable': 'Notify and play a sound when work finishes or needs you',
  'notifications.browser.granted': 'Browser notifications: allowed',
  'notifications.browser.default': 'Browser notifications: not asked yet',
  'notifications.browser.request': 'Ask',
  'notifications.browser.denied': 'Browser notifications: blocked',
  'notifications.browser.deniedHint': 'This browser blocks notifications for this site; allow them in the site settings (address bar), then reload this page.',
  'notifications.browser.unsupported': 'This browser does not support system notifications',
  'notifications.event.done': 'Work finished',
  'notifications.event.attention': 'Needs your attention',
  'notifications.event.error': 'Error occurred',
  'notifications.sound.chime': 'Chime',
  'notifications.sound.ping': 'Ping',
  'notifications.sound.bell': 'Bell',
  'notifications.sound.pulse': 'Pulse',
  'notifications.preview': 'Preview',
} satisfies Record<NotificationsKey, string>
