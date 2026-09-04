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
import type { DeviceConfig } from './DeviceStorage.ts'
import { selectCandidates } from './EndpointSelection.ts'
import { channelUrlOf } from './PairingProtocol.ts'

/** State of the native device channel, reported by the foreground service. */
export interface ChannelState {
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
  start(options: { wsUrls: string[]; secret: string; deviceId: string; deviceName: string }): Promise<void>
  stop(): Promise<void>
  setNotificationPermission(): Promise<void>
  getChannelState(): Promise<ChannelState>
  getNetworkState(): Promise<{ vpnActive: boolean }>
  getLaunchSession(): Promise<{ sessionId?: string }>
  addListener(eventName: 'channelState', cb: (state: ChannelState) => void): Promise<{ remove: () => void }>
  addListener(eventName: 'openSession', cb: (data: { sessionId: string }) => void): Promise<{ remove: () => void }>
}

const plugin = registerPlugin<DeviceChannelPlugin>('DeviceChannel')

/** Start the foreground notification channel for a paired device. */
export async function startNotificationService(config: DeviceConfig): Promise<void> {
  const wsUrls = selectCandidates(config.endpoints, config.serverUrl).map(channelUrlOf)
  await plugin.start({
    wsUrls,
    secret: config.deviceSecret,
    deviceId: config.deviceId,
    deviceName: config.deviceName,
  })
}

/** Stop the foreground notification channel (e.g. on disconnect). */
export async function stopNotificationService(): Promise<void> {
  await plugin.stop()
}

/** Request notification permission (Android 13+ POST_NOTIFICATIONS). */
export async function ensureNotificationPermission(): Promise<void> {
  await plugin.setNotificationPermission()
}

/** Read the current native channel state. */
export async function getChannelState(): Promise<ChannelState> {
  return plugin.getChannelState()
}

/** Whether Android currently exposes an active VPN transport. */
export async function isVpnActive(): Promise<boolean> {
  return (await plugin.getNetworkState()).vpnActive
}

/** Subscribe to native channel-state changes (connect, drop, origin migration). */
export function onChannelState(cb: (state: ChannelState) => void): Promise<{ remove: () => void }> {
  return plugin.addListener('channelState', cb)
}

/** Read the pending session id from a launch intent, if any. */
export async function getLaunchSession(): Promise<string | undefined> {
  const result = await plugin.getLaunchSession().catch(() => ({ sessionId: undefined }))
  return result.sessionId
}

/** Subscribe to session open requests from notification taps. */
export function onOpenSession(cb: (sessionId: string) => void): Promise<{ remove: () => void }> {
  return plugin.addListener('openSession', (data) => {
    if (data.sessionId) cb(data.sessionId)
  })
}
