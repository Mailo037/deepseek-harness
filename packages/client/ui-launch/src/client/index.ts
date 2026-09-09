/**
 * Launch-at-computer-start plugin, browser half: binds the durable
 * `ui-launch` settings namespace, provides the preference controller, and
 * registers the preference row into the settings General section. Where the
 * Host composed no `ui-launch` namespace (no launch backend — e.g. plain
 * `dsh web`) the scope reports unavailable and the row renders nothing, so a
 * switch that could not act never appears.
 */
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: the ctx.settingsScope Context merge. Cross-plugin collaboration
// goes through the service, never a value import (client bundle purity gate).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import {
  LAUNCH_SETTINGS_NAMESPACE, type LaunchSettings,
} from '../launch-settings.ts'
import { LaunchSettingsController, type LaunchSnapshot } from './controller.ts'
import { LaunchRow, type LaunchRowInjected } from './LaunchRow.tsx'
import { createLaunchRowStore } from './store.ts'
import { en, zh, type LaunchKey } from './locales.ts'

export type { LaunchRowComponentProps, LaunchRowInjected } from './LaunchRow.tsx'
export type { LaunchSnapshot } from './controller.ts'
export type { LaunchKey } from './locales.ts'
export type { LaunchSettings } from '../launch-settings.ts'

/** Namespace owning this feature's settings-row copy. */
export const SETTINGS_NS = 'settings.launch'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The launch settings row's copy. */
    'settings.launch': LaunchKey
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The launch preference controller (provided by this plugin). */
    launch: LaunchSettingsController
  }
  interface Events {
    /**
     * Preference state changed (row write or Host adoption).
     * @param snapshot - Current immutable preference snapshot.
     * @mode emit
     */
    'launch/change'(snapshot: LaunchSnapshot): void
  }
}

/**
 * Required services: settings transport plus slots/locale for the row.
 * `remote` carries the forwarded settings invalidation that
 * `ctx.settingsScope.bind(spec)` subscribes to on this context.
 */
export const inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope']

/**
 * Client plugin body: provide the preference controller and register the
 * feature-owned preference row into the General section's item slot.
 * @param ctx - client cordis context.
 */
export function apply(ctx: ClientContext): void {
  const host = ctx.settingsScope.bind<LaunchSettings>({ namespace: LAUNCH_SETTINGS_NAMESPACE })
  const controller = new LaunchSettingsController(ctx, host)

  ctx.provide('launch', controller)
  ctx.effect(() => ctx.locale.register(SETTINGS_NS, { zh, en }), 'ui-launch: settings row dictionaries')

  const store = createLaunchRowStore()
  let bound: BoundActions<typeof store> | undefined
  const sync = (snapshot: LaunchSnapshot): void => {
    bound?.sync(snapshot)
  }
  ctx.on('launch/change', sync)
  const injected = (actions: BoundActions<typeof store>): LaunchRowInjected => {
    bound = actions
    // Re-sync from the getter so no event is lost between registration and
    // first render (the store's revision guard drops stale duplicates).
    sync(controller.getSnapshot())
    return {
      setLaunchAtLogin: (launchAtLogin) => { controller.setLaunchAtLogin(launchAtLogin) },
    }
  }
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'launch',
    order: 12,
    store,
    locale: SETTINGS_NS,
    inject: injected,
  }, LaunchRow))
}
