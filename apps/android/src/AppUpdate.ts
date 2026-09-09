/**
 * Starts the native, best-effort GitHub Release updater. The native side
 * validates release and APK identity before handing a downloaded update to
 * Android's package installer; the WebView never navigates away from the app.
 */

import { registerPlugin } from '@capacitor/core'

interface AppUpdatePlugin {
  check(options: { manual: boolean }): Promise<{ status: 'current' | 'installerOpened' | 'incompatible' | 'busy' | 'skipped' }>
}

const plugin = registerPlugin<AppUpdatePlugin>('AppUpdate')

/** Automatic checks run once per process; manual checks allow download and install retries. */
export async function checkForAppUpdate(manual = false): ReturnType<AppUpdatePlugin['check']> {
  return plugin.check({ manual })
}
