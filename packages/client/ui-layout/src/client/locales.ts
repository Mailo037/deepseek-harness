/** `layout` namespace dictionaries: frame chrome copy (sidebar reveal). */

/** Dictionary namespace owned by this plugin. */
export const NS = 'layout'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'sidebar.reveal': '打开侧边栏',
} as const

/** English dictionary, key-identical to the Chinese source of truth. */
export const en: Record<LayoutKey, string> = {
  'sidebar.reveal': 'Open sidebar',
}

/** Key domain of the `layout` namespace (zh is the source of truth). */
export type LayoutKey = keyof typeof zh
