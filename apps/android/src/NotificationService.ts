/**
 * Bridge to the native Android foreground notification service
 * (DeviceChannelService). The service owns the persistent WebSocket to the
 * PC's `/remote/device` channel, authenticates with the device secret, tries
 * the stored endpoints in order (last-successful first), and posts Android
 * notifications when the host pushes "session needs attention" frames. This
 * module starts/stops it from the WebView side and forwards channel-state
 * changes (including which origin is connected) to JS listeners and exposes
 * the active Android VPN transport for connection guidance.
 */

import { registerPlugin } from '@capacitor/core'
import type { SavedHarness } from './HarnessStorage.ts'
import { selectCandidates } from './EndpointSelection.ts'
import { channelUrlOf } from './PairingProtocol.ts'

/** State of the native device channel, reported by the foreground service. */
export interface ChannelState {
  harnessId: string
  connected: boolean
  /** Origin the channel is currently connected to, when connected. */
  serverUrl?: string
  /** Current GUI token received from the authenticated host channel. */
  accessToken?: string
}

/**
 * The custom native plugin surface (implemented by
 * `ai.deepseek.harness.remote.DeviceChannelPlugin`). The runtime bridge is
 * registered below; the app type checks against this structural interface.
 */
interface DeviceChannelPlugin {
  start(options: { harnessId: string; name: string; wsUrls: string[]; secret: string; deviceId: string; deviceName: string }): Promise<void>
  stop(options: { harnessId: string }): Promise<void>
  setNotificationPermission(): Promise<void>
  getChannelState(options: { harnessId: string }): Promise<ChannelState>
  getNetworkState(): Promise<{ vpnActive: boolean }>
  getLaunchSession(): Promise<Partial<SessionTarget>>
  addListener(eventName: 'channelState', cb: (state: ChannelState) => void): Promise<{ remove: () => void }>
  addListener(eventName: 'openSession', cb: (data: SessionTarget) => void): Promise<{ remove: () => void }>
}

const plugin = registerPlugin<DeviceChannelPlugin>('DeviceChannel')

/** Start the foreground notification channel for a paired device. */
export async function startNotificationService(harness: SavedHarness): Promise<void> {
  const { config } = harness
  const wsUrls = selectCandidates(config.endpoints, config.serverUrl).map(channelUrlOf)
  await plugin.start({
    harnessId: harness.id,
    name: harness.name,
    wsUrls,
    secret: config.deviceSecret,
    deviceId: config.deviceId,
    deviceName: config.deviceName,
  })
}

/** Stop the foreground notification channel (e.g. on disconnect). */
export async function stopNotificationService(harnessId: string): Promise<void> {
  await plugin.stop({ harnessId })
}

/** Request notification permission (Android 13+ POST_NOTIFICATIONS). */
export async function ensureNotificationPermission(): Promise<void> {
  await plugin.setNotificationPermission()
}

/** Read the current native channel state. */
export async function getChannelState(harnessId: string): Promise<ChannelState> {
  return plugin.getChannelState({ harnessId })
}

/** Whether Android currently exposes an active VPN transport. */
export async function isVpnActive(): Promise<boolean> {
  return (await plugin.getNetworkState()).vpnActive
}

/** Subscribe to native channel-state changes (connect, drop, origin migration). */
export function onChannelState(cb: (state: ChannelState) => void): Promise<{ remove: () => void }> {
  return plugin.addListener('channelState', cb)
}

/** A notification identifies both its Harness and session. */
export interface SessionTarget {
  harnessId: string
  sessionId: string
}

/** Consume the notification that launched the Android activity. */
export async function getLaunchSession(): Promise<SessionTarget | undefined> {
  const result = await plugin.getLaunchSession()
  return typeof result.harnessId === 'string' && typeof result.sessionId === 'string'
    ? { harnessId: result.harnessId, sessionId: result.sessionId }
    : undefined
}

/** Subscribe to notification taps from every saved Harness. */
export function onOpenSession(cb: (target: SessionTarget) => void): Promise<{ remove: () => void }> {
  return plugin.addListener('openSession', cb)
}
