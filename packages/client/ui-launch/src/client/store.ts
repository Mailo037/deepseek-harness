/**
 * Launch row slot store: a mirror of the LaunchSettingsController snapshot.
 * The plugin's apply-world change listener is the only writer; the row
 * component reads via props.useStore.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { LaunchSnapshot } from './controller.ts'

/** Store state mirrored from the controller snapshot. */
export type LaunchRowState = Omit<LaunchSnapshot, never>

/** Declared action shape giving the exported factory a stable return type. */
type LaunchRowActions = {
  sync: (draft: LaunchRowState, snapshot: LaunchSnapshot) => void
}

/**
 * Declares the launch row state and write surface.
 * @returns the store handle.
 */
export function createLaunchRowStore(): EngineStoreHandle<LaunchRowState, LaunchRowActions> {
  return defineStore({
    init: (): LaunchRowState => ({
      launchAtLogin: false,
      available: false,
      writable: false,
      revision: -1,
    }),
    actions: {
      sync: (d, snapshot) => {
        if (snapshot.revision <= d.revision) return
        d.launchAtLogin = snapshot.launchAtLogin
        d.available = snapshot.available
        d.writable = snapshot.writable
        d.revision = snapshot.revision
      },
    },
  })
}
