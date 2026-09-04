/**
 * Remote devices Settings section, browser half: registers the `settings.section`
 * entry “Remote devices” (QR pairing code + paired device list + instant revoke)
 * over the host `device` Remote namespace.
 * Export discipline: packages/client/AGENTS.md.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ConnectionHandle, RemoteDeviceId } from '@deepseek-ai/dsh-api-remotes/client'
import {
  RemoteSettingsSection,
  type RemoteSettingsSectionInjected,
} from './RemoteSettingsSection.tsx'
import { FsDenySection, type FsDenySectionInjected, type FsDenySettings } from './FsDenySection.tsx'
import { en, zh, type RemoteLocaleKey } from './locales.ts'

export type {
  RemoteSettingsSectionInjected, RemoteSettingsSectionProps, TailscaleSendOutcome,
} from './RemoteSettingsSection.tsx'
export type { FsDenySectionInjected, FsDenySectionProps } from './FsDenySection.tsx'
export type { RemoteLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Remote devices Settings section copy. */
    'settings.remote': RemoteLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.remote'

/** Services required by the Settings registration and the Remote face. The
 * `remote.device` namespace service is declared explicitly: the Cordis
 * property proxy rejects `ctx.remote.device` reads without the injection. */
export const inject = ['slots', 'locale', 'settingsScope', 'remote', 'remote.device', 'sessions']

/**
 * Register the Remote devices section. The host `device` namespace must be
 * mounted before the section becomes functional; registration itself only
 * waits for the settings.section declaration.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-remote: dictionaries')

  const t = ctx.locale.bind(NS)
  const createPairing: RemoteSettingsSectionInjected['createPairing'] = async () => {
    const result = await ctx.remote.device.pairingCreate()
    if (!result.ok) {
      throw new Error(`device.pairingCreate failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }
  const listDevices: RemoteSettingsSectionInjected['listDevices'] = async () => {
    const result = await ctx.remote.device.devicesList()
    if (!result.ok) {
      throw new Error(`device.devicesList failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }
  const revokeDevice: RemoteSettingsSectionInjected['revokeDevice'] = async (deviceId: RemoteDeviceId) => {
    const result = await ctx.remote.device.devicesRevoke({ deviceId })
    if (!result.ok) {
      throw new Error(`device.devicesRevoke failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }
  const getAccessToken: RemoteSettingsSectionInjected['getAccessToken'] = async () => {
    const result = await ctx.remote.device.accessTokenGet()
    if (!result.ok) {
      throw new Error(`device.accessTokenGet failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }
  const sendTailscaleSetup: RemoteSettingsSectionInjected['sendTailscaleSetup'] = async () => {
    // The current route must be an ordinary session: a subagent route
    // (currentAddress set) has no host tools to run the setup with.
    const list = ctx.sessions.list.getSnapshot()
    const current = list.current
    if (current === undefined || list.currentAddress !== undefined) return { ok: false, reason: 'no-session' }
    const session = ctx.sessions.binding(current)?.session
    if (session === undefined) return { ok: false, reason: 'no-session' }
    const result = await session.prompt([{ type: 'text', text: t('tailscalePrompt') }], 'queue')
    if (!result.ok) return { ok: false, reason: 'error' }
    return { ok: true }
  }
  const connection = ctx.get('connection') as ConnectionHandle | undefined
  const isLoopback = connection?.isLoopback ?? true

  const injected = (): RemoteSettingsSectionInjected => ({
    createPairing,
    listDevices,
    revokeDevice,
    getAccessToken,
    sendTailscaleSetup,
    isLoopback,
  })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'remote',
    order: 15,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, RemoteSettingsSection))

  // ── Access restrictions section ──
  const fsDenyScope = ctx.settingsScope.bind<FsDenySettings>({ namespace: 'fs-deny' })
  const fsDenyInjected = (): FsDenySectionInjected => ({ settingsScope: fsDenyScope, isLoopback })
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'fs-deny',
    order: 30,
    label: () => t('fsDenyNav'),
    locale: NS,
    inject: fsDenyInjected,
  }, FsDenySection))
}
