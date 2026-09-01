package ai.deepseek.harness.remote

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat

/**
 * Restarts the persistent notification channel after a device reboot. It
 * reads the last-known channel parameters persisted by
 * [DeviceChannelPlugin] (ordered candidate URLs, device secret, device id)
 * and starts the specialUse foreground service. `specialUse` is not on
 * Android 15's BOOT_COMPLETED foreground-service restriction list, so this
 * is allowed.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        val params = DeviceChannelPlugin.loadChannelParams(context) ?: return
        val (wsUrls, secret, deviceId) = params
        if (wsUrls.isEmpty()) return
        val start = DeviceChannelService.startIntent(context, wsUrls, secret, deviceId, "Android")
        ContextCompat.startForegroundService(context, start)
    }
}
