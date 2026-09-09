package ai.deepseek.harness.remote

import android.app.*
import android.content.*
import android.content.pm.ServiceInfo
import android.net.*
import android.os.*
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import okhttp3.*
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import kotlin.random.Random

/** One foreground service with independent authenticated channels; all mutations run on the main looper. */
class DeviceChannelService : Service() {
    private val handler = Handler(Looper.getMainLooper())
    private val client = OkHttpClient.Builder().pingInterval(25, TimeUnit.SECONDS).connectTimeout(10, TimeUnit.SECONDS).build()
    private val channels = mutableMapOf<String, Channel>()
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private var idleReceiver: BroadcastReceiver? = null

    companion object {
        const val ACTION_START = "start"
        const val ACTION_STOP = "stop"
        private const val CHANNEL_ID = "harness-remote-attention"
        private const val FOREGROUND_ID = 42
        private val states = java.util.concurrent.ConcurrentHashMap<String, JSONObject>()
        fun state(id: String): JSONObject = states[id] ?: JSONObject().put("harnessId", id).put("connected", false)
        fun startIntent(context: Context, params: JSONObject): Intent = Intent(context, DeviceChannelService::class.java)
            .setAction(ACTION_START).putExtra("params", params.toString())
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            val id = intent.getStringExtra("harnessId") ?: return START_NOT_STICKY
            channels.remove(id)?.dispose()
            states.remove(id)
            DeviceChannelPlugin.removeChannel(this, id)
            if (channels.isEmpty()) { stopForeground(STOP_FOREGROUND_REMOVE); stopSelf() }
            else updateForeground()
            return if (channels.isEmpty()) START_NOT_STICKY else START_STICKY
        }
        val raw = intent?.getStringExtra("params")
        val additions = if (raw != null) listOf(JSONObject(raw)) else DeviceChannelPlugin.loadChannels(this)
        for (params in additions) {
            val id = params.getString("harnessId")
            if (channels[id]?.params?.toString() == params.toString()) continue
            channels.remove(id)?.dispose()
            DeviceChannelPlugin.persistChannel(this, params)
            val channel = Channel(params)
            channels[id] = channel
            channel.connect()
        }
        if (channels.isEmpty()) { stopSelf(); return START_NOT_STICKY }
        updateForeground()
        registerCallbacks()
        return START_STICKY
    }

    private fun updateForeground() {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "Remote session attention", NotificationManager.IMPORTANCE_HIGH))
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Harness Remote").setContentText("Monitoring ${channels.size} Harness connections")
            .setSmallIcon(android.R.drawable.ic_dialog_info).setOngoing(true)
            .setContentIntent(openAppIntent(null, null)).build()
        if (Build.VERSION.SDK_INT >= 34) startForeground(FOREGROUND_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        else startForeground(FOREGROUND_ID, notification)
    }

    private fun openAppIntent(harnessId: String?, sessionId: String?): PendingIntent {
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            if (harnessId != null && sessionId != null) {
                putExtra("harnessId", harnessId)
                putExtra("sessionId", sessionId)
                data = Uri.Builder().scheme("harness-remote").authority("session").appendPath(harnessId).appendPath(sessionId).build()
            }
        }
        return PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    private inner class Channel(val params: JSONObject) {
        val id = params.getString("harnessId")
        private val name = params.getString("name")
        private val urls = params.getJSONArray("wsUrls").let { a -> (0 until a.length()).map { a.getString(it) } }.toMutableList()
        private var socket: WebSocket? = null
        private var index = 0
        private var attempt = 0
        private var disposed = false
        private var rejected = false
        private var connected = false
        private var reconnect: Runnable? = null
        private var timeout: Runnable? = null

        fun connect() {
            if (disposed || rejected) return
            reconnect?.let(handler::removeCallbacks)
            reconnect = null
            if (index >= urls.size) {
                index = 0
                val base = minOf(60_000L, 1_000L * (1L shl attempt.coerceAtMost(6)))
                attempt++
                reconnect = Runnable { connect() }.also { handler.postDelayed(it, minOf(60_000L, base + Random.nextLong(base / 2 + 1))) }
                return
            }
            val url = urls[index++]
            socket = client.newWebSocket(Request.Builder().url(url).build(), object : WebSocketListener() {
                override fun onOpen(ws: WebSocket, response: Response) { handler.post {
                    if (!disposed && socket === ws) ws.send(JSONObject().put("type", "auth").put("secret", params.getString("secret")).toString())
                } }
                override fun onMessage(ws: WebSocket, text: String) { handler.post {
                    if (disposed || socket !== ws) return@post
                    val frame = try { JSONObject(text) } catch (_: Exception) { return@post }
                    when (frame.optString("type")) {
                        "authed" -> {
                            val token = frame.opt("accessToken") as? String
                            if (token == null || frame.optString("deviceId") != params.getString("deviceId")) { failed(ws); return@post }
                            timeout?.let(handler::removeCallbacks)
                            timeout = null
                            connected = true
                            attempt = 0
                            index = 0
                            urls.remove(url); urls.add(0, url)
                            val origin = url.removeSuffix("/remote/device").replaceFirst("ws://", "http://").replaceFirst("wss://", "https://")
                            DeviceChannelPlugin.persistGuiAccessToken(this@DeviceChannelService, id, token)
                            publish(JSONObject().put("harnessId", id).put("connected", true).put("serverUrl", origin).put("accessToken", token))
                        }
                        "rejected" -> { rejected = true; failed(ws) }
                        "notification" -> if (connected) {
                            val notice = frame.optJSONObject("notification") ?: return@post
                            val session = notice.optString("sessionId")
                            if (session.isEmpty()) return@post
                            val notification = NotificationCompat.Builder(this@DeviceChannelService, CHANNEL_ID)
                                .setContentTitle(name).setContentText(notice.optString("message", "Session needs attention"))
                                .setStyle(NotificationCompat.BigTextStyle().bigText(notice.optString("message")))
                                .setSmallIcon(android.R.drawable.ic_dialog_info).setAutoCancel(true)
                                .setContentIntent(openAppIntent(id, session)).build()
                            try {
                                getSystemService(NotificationManager::class.java).notify("$id/$session", 1, notification)
                            } catch (_: SecurityException) {
                                // Revoked notification permission does not terminate other Harness channels.
                            }
                        }
                    }
                } }
                override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) { handler.post { failed(ws) } }
                override fun onClosing(ws: WebSocket, code: Int, reason: String) { handler.post { failed(ws) } }
                override fun onClosed(ws: WebSocket, code: Int, reason: String) { handler.post { failed(ws) } }
            })
            val pending = socket
            timeout = Runnable { if (pending != null) failed(pending) }.also { handler.postDelayed(it, 10_000) }
        }

        private fun publish(state: JSONObject) { states[id] = state; DeviceChannelPlugin.notifyChannelState(state) }
        private fun failed(ws: WebSocket) {
            if (disposed || socket !== ws) return
            timeout?.let(handler::removeCallbacks); timeout = null
            socket = null
            ws.cancel()
            connected = false
            publish(JSONObject().put("harnessId", id).put("connected", false))
            connect()
        }
        fun resume() {
            if (disposed || rejected || connected) return
            reconnect?.let(handler::removeCallbacks); reconnect = null
            timeout?.let(handler::removeCallbacks); timeout = null
            val previous = socket; socket = null; previous?.cancel()
            index = 0
            connect()
        }
        fun dispose() {
            disposed = true
            reconnect?.let(handler::removeCallbacks)
            timeout?.let(handler::removeCallbacks)
            val previous = socket; socket = null; previous?.cancel()
            states.remove(id)
        }
    }

    private fun registerCallbacks() {
        if (networkCallback != null) return
        val manager = getSystemService(ConnectivityManager::class.java)
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) { handler.post { channels.values.forEach { it.resume() } } }
            override fun onLinkPropertiesChanged(network: Network, properties: LinkProperties) { handler.post { channels.values.forEach { it.resume() } } }
        }
        try {
            manager.registerDefaultNetworkCallback(callback)
            networkCallback = callback
        } catch (_: RuntimeException) {
            // OEM registration limits leave each channel's timed retry active.
        }
        if (idleReceiver != null) return
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                if (!(getSystemService(POWER_SERVICE) as PowerManager).isDeviceIdleMode) channels.values.forEach { it.resume() }
            }
        }
        ContextCompat.registerReceiver(this, receiver, IntentFilter(PowerManager.ACTION_DEVICE_IDLE_MODE_CHANGED), ContextCompat.RECEIVER_NOT_EXPORTED)
        idleReceiver = receiver
    }

    override fun onTimeout(startId: Int, fgsType: Int) { stopSelf() }
    override fun onDestroy() {
        channels.values.forEach { it.dispose() }; channels.clear()
        networkCallback?.let {
            try { getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(it) }
            catch (_: IllegalArgumentException) { /* Android has already removed this callback. */ }
        }
        idleReceiver?.let {
            try { unregisterReceiver(it) }
            catch (_: IllegalArgumentException) { /* Android has already removed this receiver. */ }
        }
        handler.removeCallbacksAndMessages(null)
        client.dispatcher.executorService.shutdown()
        client.connectionPool.evictAll()
        super.onDestroy()
    }
}
