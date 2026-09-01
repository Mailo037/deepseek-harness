/** `deliverables` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'deliverables'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'produced.label': '产物',
  'produced.moreOne': '+ 1 个文件',
  'produced.more': '+ {count} 个文件',
  'produced.open': '打开 {name}',
  'produced.showInFolder': '在文件夹中显示',
  'produced.hide': '收起',
  'changes.summaryOne': '已更改 {count} 个文件',
  'changes.summary': '已更改 {count} 个文件',
  'changes.aria': '已更改 {files} 个文件，新增 {added} 行，删除 {removed} 行',
  'changes.close': '关闭',
}

/** English dictionary (same key set). */
export const en: Record<DeliverablesKey, string> = {
  'produced.label': 'Produced',
  'produced.moreOne': '+ 1 file',
  'produced.more': '+ {count} files',
  'produced.open': 'Open {name}',
  'produced.showInFolder': 'Show in folder',
  'produced.hide': 'Hide',
  'changes.summaryOne': '{count} file changed',
  'changes.summary': '{count} files changed',
  'changes.aria': '{files} files changed, +{added} lines and -{removed} lines',
  'changes.close': 'Close',
}

/** Union of this namespace's dictionary keys. */
export type DeliverablesKey = keyof typeof zh
