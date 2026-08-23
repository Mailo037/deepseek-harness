/**
 * Notifications row slot store: a mirror of the NotificationRuntime snapshot.
 * The plugin's apply-world change listener is the only writer; the row
 * component reads via props.useStore.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { NotificationSnapshot } from './runtime.ts'

/** Store state mirrored from the runtime snapshot. */
export type NotificationsRowState = Omit<NotificationSnapshot, never>

/** Declared action shape giving the exported factory a stable return type. */
type NotificationsRowActions = {
  sync: (draft: NotificationsRowState, snapshot: NotificationSnapshot) => void
}

/**
 * Declares the notifications row state and write surface.
 * @returns the store handle.
 */
export function createNotificationsRowStore(): EngineStoreHandle<NotificationsRowState, NotificationsRowActions> {
  return defineStore({
    init: (): NotificationsRowState => ({
      enabled: false,
      doneSound: 'chime',
      attentionSound: 'bell',
      errorSound: 'pulse',
      revision: -1,
    }),
    actions: {
      sync: (d, snapshot) => {
        if (snapshot.revision <= d.revision) return
        d.enabled = snapshot.enabled
        d.doneSound = snapshot.doneSound
        d.attentionSound = snapshot.attentionSound
        d.errorSound = snapshot.errorSound
        d.revision = snapshot.revision
      },
    },
  })
}
