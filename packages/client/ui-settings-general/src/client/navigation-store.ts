/**
 * Root-scoped Settings viewing state. Browser persistence restores the
 * currently open panel and its selected section after a page reload without
 * making either fact part of a Session or the settings document.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'

/** Browser-local Settings navigation state. */
type SettingsNavigationState = {
  open: boolean
  activeSectionId: string | undefined
}

/** Complete write surface for the Settings navigation state. */
type SettingsNavigationActions = {
  open: (draft: SettingsNavigationState) => void
  close: (draft: SettingsNavigationState) => void
  select: (draft: SettingsNavigationState, id: string) => void
}

/**
 * Create the Settings navigation store handle.
 * @returns root-scoped browser-persistent navigation state.
 */
export function createSettingsNavigationStore(): EngineStoreHandle<SettingsNavigationState, SettingsNavigationActions> {
  return defineStore({
    init: (): SettingsNavigationState => ({ open: false, activeSectionId: undefined }),
    persist: 'dsh.settings.navigation',
    actions: {
      open: (draft) => { draft.open = true },
      close: (draft) => {
        draft.open = false
        draft.activeSectionId = undefined
      },
      select: (draft, id: string) => {
        draft.open = true
        draft.activeSectionId = id
      },
    },
  })
}
