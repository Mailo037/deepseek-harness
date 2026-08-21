/** Shell chrome, General-nav, and About-section dictionaries; feature rows own their copy. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'trigger': '设置',
  'title': '设置',
  'close': '关闭',
  'openDocument': '打开配置文件',
  'openDocument.error': '无法打开配置文件',
  'general.nav': '通用设置',
  'about.nav': '关于',
  'about.offline': '正在等待服务端连接…',
  'about.version': '版本',
  'about.surface': '运行环境',
  'about.surface.web': '网页端',
  'about.surface.electron': '桌面端',
  'about.branch': '分支',
  'about.commit': '提交',
  'about.repository': '仓库',
  'about.updates': '软件更新',
  'about.noRepository': '当前安装未从 Git 检出运行，无法进行软件更新。',
  'about.noRestart': '当前启动器不支持自动重启。',
  'about.check': '检查更新',
  'about.checking': '正在检查更新…',
  'about.applying': '正在停止代理并应用更新…',
  'about.restarting': '正在重启应用，页面将自动刷新…',
  'about.upToDate': '已是最新版本。',
  'about.available': '有可用更新（落后 {behind} 个提交）',
  'about.apply': '立即更新并重启',
  'about.available.short': '有可用更新',
} satisfies Record<string, string>

/** The settings namespace key union. */
export type SettingsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'trigger': 'Settings',
  'title': 'Settings',
  'close': 'Close',
  'openDocument': 'Open configuration file',
  'openDocument.error': 'Could not open configuration file',
  'general.nav': 'General',
  'about.nav': 'About',
  'about.offline': 'Waiting for the server connection…',
  'about.version': 'Version',
  'about.surface': 'Environment',
  'about.surface.web': 'Web',
  'about.surface.electron': 'Desktop',
  'about.branch': 'Branch',
  'about.commit': 'Commit',
  'about.repository': 'Repository',
  'about.updates': 'Updates',
  'about.noRepository': 'This installation does not run from a Git checkout, so updates are unavailable.',
  'about.noRestart': 'This launcher cannot restart itself automatically.',
  'about.check': 'Check for updates',
  'about.checking': 'Checking for updates…',
  'about.applying': 'Stopping agents and applying the update…',
  'about.restarting': 'Restarting the application; the page will refresh automatically…',
  'about.upToDate': 'You are up to date.',
  'about.available': 'An update is available ({behind} commits behind)',
  'about.apply': 'Update and restart',
  'about.available.short': 'Update available',
} satisfies Record<SettingsKey, string>
