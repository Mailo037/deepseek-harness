import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'ai.deepseek.harness.remote',
  appName: 'Harness Remote',
  webDir: 'dist',
  // The WebView loads the PC-served GUI from a configurable origin; the app
  // never bundles the GUI (thin-client contract). Capacitor still needs a
  // local webDir for the pairing screen, which is the app's only local UI.
  server: {
    // Pairing and connection screens ship with the app; the remote GUI is
    // loaded via WebView navigation at runtime.
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: true,
  },
}

export default config
