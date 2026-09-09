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
import org.json.JSONObject

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

    override fun load() {
        super.load()
        activePlugin = this
    }

    @PluginMethod
    fun start(call: PluginCall) {
        val harnessId = call.getString("harnessId")
        val name = call.getString("name")
        val wsUrls = call.getArray("wsUrls")
        val secret = call.getString("secret")
        val deviceId = call.getString("deviceId")
        if (harnessId.isNullOrEmpty() || name.isNullOrEmpty() || wsUrls == null || wsUrls.length() == 0 || secret == null || deviceId == null) {
            call.reject("harnessId, name, wsUrls, secret, and deviceId are required")
            return
        }
        val urls = (0 until wsUrls.length()).mapNotNull { wsUrls.getString(it) }
        if (urls.isEmpty()) {
            call.reject("wsUrls must contain at least one endpoint")
            return
        }
        activePlugin = this
        val context = context.applicationContext
        if (urls.any { !it.startsWith("ws://") && !it.startsWith("wss://") }) {
            call.reject("Channel addresses must use ws or wss")
            return
        }
        val params = JSONObject().put("harnessId", harnessId).put("name", name)
            .put("wsUrls", JSONArray(urls)).put("secret", secret).put("deviceId", deviceId)
        val intent = DeviceChannelService.startIntent(context, params)
        ContextCompat.startForegroundService(context, intent)
        call.resolve()
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        val context = context.applicationContext
        val id = call.getString("harnessId") ?: run { call.reject("harnessId is required"); return }
        val intent = Intent(context, DeviceChannelService::class.java).apply {
            action = DeviceChannelService.ACTION_STOP
            putExtra("harnessId", id)
        }
        context.startService(intent)
        call.resolve()
    }

    @PluginMethod
    fun getChannelState(call: PluginCall) {
        val id = call.getString("harnessId") ?: run { call.reject("harnessId is required"); return }
        call.resolve(JSObject(DeviceChannelService.state(id).toString()))
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

    @PluginMethod
    fun getLaunchSession(call: PluginCall) {
        val target = pendingTarget
        pendingTarget = null
        call.resolve(if (target == null) JSObject() else JSObject(target.toString()))
    }

    override fun handleOnDestroy() {
        if (activePlugin === this) activePlugin = null
        super.handleOnDestroy()
    }

    companion object {
        const val NOTIFICATIONS = "notifications"

        private const val PREFS = "dsh_remote_channel"
        private const val CAPACITOR_PREFERENCES = "CapacitorStorage"

        /** The live plugin instance [DeviceChannelService] reports state through. */
        @Volatile
        private var activePlugin: DeviceChannelPlugin? = null

        @Volatile
        private var pendingTarget: JSONObject? = null

        /**
         * Record a launch intent's session and notify active JS listeners.
         */
        @JvmStatic
        fun handleIntent(intent: Intent?) {
            val sessionId = intent?.getStringExtra("sessionId") ?: return
            val harnessId = intent.getStringExtra("harnessId") ?: return
            pendingTarget = JSONObject().put("harnessId", harnessId).put("sessionId", sessionId)
            val plugin = activePlugin ?: return
            plugin.notifyListeners("openSession", JSObject(pendingTarget.toString()))
        }

        /** Publish one Harness's state without changing the active GUI selection. */
        fun notifyChannelState(state: JSONObject) {
            activePlugin?.notifyListeners("channelState", JSObject(state.toString()))
        }

        /** Token ownership is keyed by the local Harness id, shared with HarnessStorage.ts. */
        fun persistGuiAccessToken(context: Context, id: String, token: String) {
            context.getSharedPreferences(CAPACITOR_PREFERENCES, Context.MODE_PRIVATE)
                .edit().putString("harness.$id.token", token).apply()
        }

        /** Persist independent channel parameters for boot and sticky restarts. */
        fun persistChannel(context: Context, params: JSONObject) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString("channel.${params.getString("harnessId")}", params.toString()).apply()
        }

        fun removeChannel(context: Context, id: String) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove("channel.$id").apply()
        }

        fun loadChannels(context: Context): List<JSONObject> {
            return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).all
                .filterKeys { it.startsWith("channel.") }.values.mapNotNull { value ->
                    try { JSONObject(value as String) } catch (_: Exception) { null }
                }
        }
    }
}
