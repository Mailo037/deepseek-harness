/** `settings.launch` namespace dictionaries (the launch row's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'launch.title': '开机自启',
  'launch.enable': '电脑启动时自动运行 Harness',
  'launch.hint': '开关注册或移除本 Harness 安装的系统登录启动项；注册表或登录项里同名的 DeepSeekHarness 条目归它管理。',
} satisfies Record<string, string>

/** The settings.launch namespace key union. */
export type LaunchKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'launch.title': 'Start at computer startup',
  'launch.enable': 'Launch Harness automatically when the computer starts',
  'launch.hint': "The switch registers or removes this Harness installation's system login launch entry; the DeepSeekHarness entry it manages is its own.",
} satisfies Record<LaunchKey, string>
