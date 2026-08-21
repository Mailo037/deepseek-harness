/** `shellCommand` namespace dictionaries (the shell-command card + source copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'terminal.signal': '信号 {signal}',
  'terminal.exitCode': '退出码 {code}',
  'terminal.running': '运行中',
  'terminal.failed': '失败',
  'terminal.done': '已完成',
  'terminal.noOutput': '无输出',
  'terminal.collapseAria': '收起输出',
  'terminal.expandAria': '展开其余 {n} 行输出',
  'terminal.expandRest': '… 其余 {n} 行',
  'notice.imagesUnsupported': '! 命令不接受图片附件，请先移除图片',
} satisfies Record<string, string>

/** The shell-command namespace key union. */
export type ShellCommandKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'terminal.signal': 'signal {signal}',
  'terminal.exitCode': 'exit code {code}',
  'terminal.running': 'Running',
  'terminal.failed': 'Failed',
  'terminal.done': 'Done',
  'terminal.noOutput': 'No output',
  'terminal.collapseAria': 'Collapse output',
  'terminal.expandAria': 'Expand the remaining {n} output lines',
  'terminal.expandRest': '… {n} more lines',
  'notice.imagesUnsupported': '! commands do not accept image attachments; remove them first',
} satisfies Record<ShellCommandKey, string>

/** The locale namespace key this plugin registers. */
export const NS = 'shellCommand' as const
