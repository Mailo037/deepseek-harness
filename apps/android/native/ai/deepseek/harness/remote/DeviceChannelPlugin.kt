package ai.deepseek.harness.remote

import android.Manifest
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.PermissionState
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import org.json.JSONArray

/**
 * Capacitor bridge between the app's WebView and [DeviceChannelService]:
 * starts/stops the foreground notification channel, requests the
 * POST_NOTIFICATIONS permission on Android 13+, and forwards channel-state
 * changes (connected origin) to JS listeners. It also reports whether the
 * active Android network uses a VPN transport for Tailscale guidance. The
 * permission alias and callback are declared so the pending call always
 * settles — an undeclared alias leaves the JS-side await hanging forever.
 */
@CapacitorPlugin(
    name = "DeviceChannel",
    permissions = [
        Permission(
            strings = [Manifest.permission.POST_NOTIFICATIONS],
            alias = DeviceChannelPlugin.NOTIFICATIONS,
        ),
    ],
)
class DeviceChannelPlugin : Plugin() {

    @PluginMethod
    fun start(call: PluginCall) {
        val wsUrls = call.getArray("wsUrls")
        val secret = call.getString("secret")
        val deviceId = call.getString("deviceId")
        val deviceName = call.getString("deviceName") ?: "Android"
        if (wsUrls == null || wsUrls.length() == 0 || secret == null || deviceId == null) {
            call.reject("wsUrls, secret, and deviceId are required")
            return
        }
        val urls = (0 until wsUrls.length()).mapNotNull { wsUrls.getString(it) }
        if (urls.isEmpty()) {
            call.reject("wsUrls must contain at least one endpoint")
            return
        }
        activePlugin = this
        val context = context.applicationContext
        val intent = DeviceChannelService.startIntent(context, urls, secret, deviceId, deviceName)
        ContextCompat.startForegroundService(context, intent)
        call.resolve()
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        val context = context.applicationContext
        val intent = Intent(context, DeviceChannelService::class.java).apply {
            action = DeviceChannelService.ACTION_STOP
        }
        context.startService(intent)
        call.resolve()
    }

    @PluginMethod
    fun getChannelState(call: PluginCall) {
        val data = JSObject()
        data.put("connected", DeviceChannelService.isChannelConnected)
        val origin = DeviceChannelService.connectedOrigin
        if (origin != null) data.put("serverUrl", origin)
        val accessToken = DeviceChannelService.guiAccessToken
        if (accessToken != null) data.put("accessToken", accessToken)
        call.resolve(data)
    }

    @PluginMethod
    fun getNetworkState(call: PluginCall) {
        val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val vpnActive = manager.activeNetwork?.let { network ->
            manager.getNetworkCapabilities(network)
                ?.hasTransport(NetworkCapabilities.TRANSPORT_VPN)
        } == true
        val data = JSObject()
        data.put("vpnActive", vpnActive)
        call.resolve(data)
    }

    @PluginMethod
    fun setNotificationPermission(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && getPermissionState(NOTIFICATIONS) != PermissionState.GRANTED) {
            requestPermissionForAlias(NOTIFICATIONS, call, "onNotificationsPermission")
            return
        }
        call.resolve()
    }

    @PermissionCallback
    fun onNotificationsPermission(call: PluginCall) {
        // The pairing flow does not depend on this permission; resolve either
        // way so the caller never hangs on the pending call.
        call.resolve()
    }

    override fun handleOnDestroy() {
        if (activePlugin === this) activePlugin = null
        super.handleOnDestroy()
    }

    companion object {
        const val NOTIFICATIONS = "notifications"

        private const val PREFS = "dsh_remote_channel"
        private const val PREF_WS_URLS = "last_ws_urls"
        private const val PREF_SECRET = "last_secret"
        private const val PREF_DEVICE_ID = "last_device_id"
        private const val CAPACITOR_PREFERENCES = "CapacitorStorage"
        private const val PREF_GUI_ACCESS_TOKEN = "accessToken"

        /** The live plugin instance [DeviceChannelService] reports state through. */
        @Volatile
        private var activePlugin: DeviceChannelPlugin? = null

        /**
         * Report a channel-state change to JS listeners. Called by the
         * foreground service; a no-op while no plugin instance is alive.
         */
        fun notifyChannelState(connected: Boolean, serverUrl: String?, accessToken: String? = null) {
            val plugin = activePlugin ?: return
            val data = JSObject()
            data.put("connected", connected)
            if (serverUrl != null) data.put("serverUrl", serverUrl)
            if (accessToken != null) data.put("accessToken", accessToken)
            plugin.notifyListeners("channelState", data)
        }

        /**
         * Move the just-authenticated channel URL to the front of the
         * boot-persisted candidate list so [BootReceiver] and sticky restarts
         * try the working endpoint first. Secrets never reach logs.
         */
        fun persistLastSuccessful(context: Context, wsUrl: String) {
            val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val stored = prefs.getString(PREF_WS_URLS, null) ?: return
            val urls = mutableListOf<String>()
            try {
                val array = JSONArray(stored)
                for (i in 0 until array.length()) urls.add(array.getString(i))
            } catch (_: Exception) {
                // A corrupted persisted list cannot be reordered; the next
                // full start (Plugin.start) rewrites it from the TS side.
                return
            }
            val reordered = buildList {
                add(wsUrl)
                urls.filterTo(this) { it != wsUrl }
            }
            prefs.edit().putString(PREF_WS_URLS, JSONArray(reordered).toString()).apply()
        }

        /** Store the current host-issued GUI token in Capacitor Preferences. */
        fun persistGuiAccessToken(context: Context, accessToken: String) {
            context.getSharedPreferences(CAPACITOR_PREFERENCES, Context.MODE_PRIVATE)
                .edit()
                .putString(PREF_GUI_ACCESS_TOKEN, accessToken)
                .apply()
        }

        /** Store the channel parameters for [BootReceiver] and sticky restarts. */
        fun persistChannelParams(context: Context, wsUrls: List<String>, secret: String, deviceId: String) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(PREF_WS_URLS, JSONArray(wsUrls).toString())
                .putString(PREF_SECRET, secret)
                .putString(PREF_DEVICE_ID, deviceId)
                .apply()
        }

        /** Read the persisted channel parameters, or null when none were stored. */
        fun loadChannelParams(context: Context): Triple<List<String>, String, String>? {
            val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val stored = prefs.getString(PREF_WS_URLS, null) ?: return null
            val secret = prefs.getString(PREF_SECRET, null) ?: return null
            val deviceId = prefs.getString(PREF_DEVICE_ID, null) ?: return null
            val urls = try {
                val array = JSONArray(stored)
                (0 until array.length()).mapNotNull { array.getString(it) }
            } catch (_: Exception) {
                emptyList()
            }
            if (urls.isEmpty()) return null
            return Triple(urls, secret, deviceId)
        }
    }
}
