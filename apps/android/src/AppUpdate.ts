/**
 * Starts the native, best-effort GitHub Release updater. The native side
 * validates release and APK identity before handing a downloaded update to
 * Android's package installer; the WebView never navigates away from the app.
 */

import { registerPlugin } from '@capacitor/core'

interface AppUpdatePlugin {
  check(): Promise<void>
}

const plugin = registerPlugin<AppUpdatePlugin>('AppUpdate')

/** Check once per process for a newer published Android release. */
export async function checkForAppUpdate(): Promise<void> {
  await plugin.check()
}
