/**
 * Durable app-side device configuration. Only the pairing result is stored:
 * the ordered endpoint list (LAN first, then Tailscale/extras), the
 * last-successful server origin, the device id, the device secret (the
 * Android foreground service reads the same values to authenticate its
 * channel), and the GUI access token (used to build the authenticated GUI
 * URL).
 */

import { Preferences } from '@capacitor/preferences'

const KEY_SERVER_URL = 'serverUrl'
const KEY_ENDPOINTS = 'endpoints'
const KEY_DEVICE_ID = 'deviceId'
const KEY_DEVICE_SECRET = 'deviceSecret'
const KEY_DEVICE_NAME = 'deviceName'
const KEY_ACCESS_TOKEN = 'accessToken'

/** What the app remembers about a paired server. */
export interface DeviceConfig {
  /** Ordered origins the GUI and channel may use (LAN first, then Tailscale/extras). */
  endpoints: string[]
  /** Last-successful origin; the GUI and channel try this first. */
  serverUrl: string
  deviceId: string
  deviceSecret: string
  deviceName: string
  /** Persistent GUI access token; empty when the host configured none. */
  accessToken: string
}

/** Build the GUI URL the WebView opens: the origin plus the token parameter. */
export function guiUrlOf(config: DeviceConfig, origin: string = config.serverUrl): string {
  if (config.accessToken.length === 0) return origin
  return `${origin}/?dsh_token=${encodeURIComponent(config.accessToken)}`
}

/** Load the stored configuration, or null when the device is not paired. */
export async function loadConfig(): Promise<DeviceConfig | null> {
  const serverUrl = await Preferences.get({ key: KEY_SERVER_URL })
  const deviceId = await Preferences.get({ key: KEY_DEVICE_ID })
  const deviceSecret = await Preferences.get({ key: KEY_DEVICE_SECRET })
  const deviceName = await Preferences.get({ key: KEY_DEVICE_NAME })
  const accessToken = await Preferences.get({ key: KEY_ACCESS_TOKEN })
  const endpointsRaw = await Preferences.get({ key: KEY_ENDPOINTS })
  if (serverUrl.value === null || deviceId.value === null || deviceSecret.value === null) {
    return null
  }
  let endpoints: string[]
  try {
    const parsed = JSON.parse(endpointsRaw.value ?? '') as unknown
    endpoints = Array.isArray(parsed) ? (parsed as string[]).filter(x => typeof x === 'string') : []
  } catch {
    endpoints = []
  }
  // Migration: a legacy config stored only serverUrl; treat it as the single
  // endpoint and as the last-successful one.
  if (endpoints.length === 0) endpoints = [serverUrl.value]
  return {
    serverUrl: serverUrl.value,
    endpoints,
    deviceId: deviceId.value,
    deviceSecret: deviceSecret.value,
    deviceName: deviceName.value ?? 'Android',
    accessToken: accessToken.value ?? '',
  }
}

/** Persist a successful pairing result. */
export async function saveConfig(config: DeviceConfig): Promise<void> {
  await Preferences.set({ key: KEY_SERVER_URL, value: config.serverUrl })
  await Preferences.set({ key: KEY_ENDPOINTS, value: JSON.stringify(config.endpoints) })
  await Preferences.set({ key: KEY_DEVICE_ID, value: config.deviceId })
  await Preferences.set({ key: KEY_DEVICE_SECRET, value: config.deviceSecret })
  await Preferences.set({ key: KEY_DEVICE_NAME, value: config.deviceName })
  await Preferences.set({ key: KEY_ACCESS_TOKEN, value: config.accessToken })
}

/** Persist the last-successful origin; append it if it is not in the list. */
export async function persistLastSuccessful(origin: string): Promise<void> {
  const config = await loadConfig()
  if (config === null) return
  config.serverUrl = origin
  if (!config.endpoints.includes(origin)) config.endpoints = [...config.endpoints, origin]
  await saveConfig(config)
}

/** Persist a GUI token refreshed by the authenticated native device channel. */
export async function persistAccessToken(accessToken: string): Promise<void> {
  await Preferences.set({ key: KEY_ACCESS_TOKEN, value: accessToken })
}

/** Forget the pairing (used by the disconnect/revoke flow). */
export async function clearConfig(): Promise<void> {
  await Preferences.remove({ key: KEY_SERVER_URL })
  await Preferences.remove({ key: KEY_ENDPOINTS })
  await Preferences.remove({ key: KEY_DEVICE_ID })
  await Preferences.remove({ key: KEY_DEVICE_SECRET })
  await Preferences.remove({ key: KEY_DEVICE_NAME })
  await Preferences.remove({ key: KEY_ACCESS_TOKEN })
}

/** Normalize a scanned or typed server URL to a canonical origin. */
export function normalizeServerUrl(input: string): string | null {
  let url: URL
  try {
    url = new URL(input.includes('://') ? input : `http://${input}`)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  return url.origin
}
