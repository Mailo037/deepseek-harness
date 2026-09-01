/**
 * System bar (Android status bar) theming. The WebView chrome should follow
 * the same light/dark scheme the app CSS picks up via prefers-color-scheme,
 * so the OS bar never renders as a white strip over the dark pairing screen.
 * Every call is best-effort: on platforms without the plugin (browser dev)
 * the OS defaults stay untouched.
 */

import { StatusBar, Style } from '@capacitor/status-bar'

const DARK_BACKGROUND = '#151517'
const LIGHT_BACKGROUND = '#ffffff'

/** Apply the status bar style and background for one color scheme. */
async function applySystemBarTheme(dark: boolean): Promise<void> {
  try {
    await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light })
    await StatusBar.setBackgroundColor({ color: dark ? DARK_BACKGROUND : LIGHT_BACKGROUND })
  } catch {
    // No native status bar (browser dev, unsupported platform): nothing to
    // theme, the WebView content is unaffected.
  }
}

/**
 * Apply the current color scheme to the system bars and keep them in sync
 * while the app runs. Returns the unsubscribe function.
 */
export function initSystemBars(): () => void {
  const query = window.matchMedia('(prefers-color-scheme: dark)')
  const apply = (): void => {
    document.body.toggleAttribute('data-ds-dark-theme', query.matches)
    document.documentElement.style.colorScheme = query.matches ? 'dark' : 'light'
    void applySystemBarTheme(query.matches)
  }
  apply()
  query.addEventListener('change', apply)
  return () => {
    query.removeEventListener('change', apply)
  }
}
