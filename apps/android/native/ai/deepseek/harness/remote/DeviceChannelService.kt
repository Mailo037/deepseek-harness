package ai.deepseek.harness.remote

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import kotlin.random.Random

/**
 * Foreground service holding the persistent WebSocket to the PC's
 * `/remote/device` channel. Authenticates with the stored device secret,
 * posts an Android notification for every host "session needs attention"
 * frame, and reconnects while the device is paired. The connection sweeps
 * the configured channel endpoints in order (last-successful first) so a
 * network switch — home Wi-Fi ↔ mobile data ↔ Tailscale — migrates without
 * re-pairing: each endpoint gets a 10 s connect window, failures move to the
 * next candidate, and a full sweep failure falls into exponential backoff
 * (1 s base, 60 s cap, 0–50 % jitter). Network availability and Doze-exit
 * events cancel the pending backoff and reconnect immediately; a `rejected`
 * auth stops reconnecting because the secret is invalid or revoked.
 *
 * The service is started by [DeviceChannelPlugin.start] with the ordered
 * channel endpoint URLs, the device secret, and the device id as intent
 * extras; it persists the same parameters for [BootReceiver] and sticky
 * restarts. Secrets never reach logs.
 */
class DeviceChannelService : Service() {

    private val client = OkHttpClient.Builder()
        .pingInterval(25, TimeUnit.SECONDS)
        .connectTimeout(10, TimeUnit.SECONDS)
        .build()

    private var socket: WebSocket? = null
    private var activeWsUrl: String? = null
    private var reconnectAttempt = 0
    private var stopRequested = false
    private var reconnectDisabled = false
    private var wsUrls: List<String> = emptyList()
    private var remainingCandidates: List<String> = emptyList()
    private var secret = ""
    private var deviceId = ""
    private var backoffThread: Thread? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private var idleReceiver: BroadcastReceiver? = null

    companion object {
        private const val TAG = "DeviceChannelService"
        private const val CHANNEL_ID = "harness-remote-attention"
        private const val NOTIFICATION_ID = 42
        const val EXTRA_WS_URLS = "wsUrls"
        const val EXTRA_SECRET = "secret"
        const val EXTRA_DEVICE_ID = "deviceId"
        const val EXTRA_DEVICE_NAME = "deviceName"
        const val EXTRA_ACTION = "action"
        const val ACTION_START = "start"
        const val ACTION_STOP = "stop"

        private const val BACKOFF_BASE_MS = 1_000L
        private const val BACKOFF_CAP_MS = 60_000L

        /** Whether the device channel is currently authenticated. */
        @Volatile
        var isChannelConnected: Boolean = false
            private set

        /** The HTTP origin the channel is currently connected to. */
        @Volatile
        var connectedOrigin: String? = null
            private set

        /** Current GUI token delivered by the host's authenticated channel. */
        @Volatile
        var guiAccessToken: String? = null
            private set

        /** Build the start intent with the channel parameters. */
        fun startIntent(context: Context, wsUrls: List<String>, secret: String, deviceId: String, deviceName: String): Intent =
            Intent(context, DeviceChannelService::class.java).apply {
                action = ACTION_START
                putExtra(EXTRA_WS_URLS, wsUrls.toTypedArray())
                putExtra(EXTRA_SECRET, secret)
                putExtra(EXTRA_DEVICE_ID, deviceId)
                putExtra(EXTRA_DEVICE_NAME, deviceName)
            }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action
        if (action == ACTION_STOP) {
            stopRequested = true
            socket?.close(1000, "service stopped")
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }
        val params = readParams(intent)
        if (params == null) {
            stopSelf()
            return START_NOT_STICKY
        }
        val (urls, inSecret, inDeviceId) = params
        wsUrls = urls
        remainingCandidates = urls
        secret = inSecret
        deviceId = inDeviceId
        stopRequested = false
        reconnectDisabled = false
        startForegroundWithChannel(deviceId)
        registerSystemCallbacks()
        connectToCandidates()
        // Recreate the service if the system kills it (sticky), so the
        // notification channel survives process death.
        return START_STICKY
    }

    /** Intent extras when present, otherwise the boot-persisted parameters. */
    private fun readParams(intent: Intent?): Triple<List<String>, String, String>? {
        if (intent != null && intent.hasExtra(EXTRA_WS_URLS)) {
            val urls = intent.getStringArrayExtra(EXTRA_WS_URLS)?.toList() ?: emptyList()
            val inSecret = intent.getStringExtra(EXTRA_SECRET)
            val inDeviceId = intent.getStringExtra(EXTRA_DEVICE_ID)
            if (urls.isNotEmpty() && inSecret != null && inDeviceId != null) {
                DeviceChannelPlugin.persistChannelParams(this, urls, inSecret, inDeviceId)
                return Triple(urls, inSecret, inDeviceId)
            }
            return null
        }
        // A sticky restart redelivers a null intent: recover the persisted
        // parameters (the same store BootReceiver reads after a reboot).
        return DeviceChannelPlugin.loadChannelParams(this)
    }

    private fun startForegroundWithChannel(deviceId: String) {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Remote session attention",
                NotificationManager.IMPORTANCE_HIGH,
            ).apply { description = "Session needs attention notifications from the PC" }
            manager.createNotificationChannel(channel)
        }
        val notification: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Harness Remote")
            .setContentText("Connected — notifications active")
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setOngoing(true)
            .setContentIntent(openAppIntent())
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun openAppIntent(sessionId: String? = null): PendingIntent {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
            ?: Intent(this, MainActivity::class.java)
        val intent = launchIntent.apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            if (!sessionId.isNullOrEmpty()) {
                putExtra("sessionId", sessionId)
            }
        }
        val requestCode = if (!sessionId.isNullOrEmpty()) (sessionId.hashCode() and 0x7fffffff) + 100 else 0
        return PendingIntent.getActivity(
            this, requestCode, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun connectToCandidates() {
        remainingCandidates = wsUrls
        tryNextCandidate()
    }

    /** Open a socket to the next candidate; a full sweep failure backs off. */
    private fun tryNextCandidate() {
        val wsUrl = remainingCandidates.firstOrNull()
        if (wsUrl == null) {
            scheduleReconnect()
            return
        }
        remainingCandidates = remainingCandidates.drop(1)
        activeWsUrl = wsUrl
        val request = Request.Builder().url(wsUrl).build()
        socket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                val hello = JSONObject()
                    .put("type", "auth")
                    .put("secret", secret)
                webSocket.send(hello.toString())
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                handleFrame(text)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                if (stopRequested || webSocket !== socket) return
                setChannelDisconnected()
                tryNextCandidate()
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                if (stopRequested || webSocket !== socket) return
                setChannelDisconnected()
                tryNextCandidate()
            }
        })
    }

    private fun handleFrame(text: String) {
        try {
            val frame = JSONObject(text)
            when (frame.optString("type")) {
                "authed" -> onAuthed(frame)
                "rejected" -> onRejected(frame)
                "notification" -> postAttentionFrame(frame)
            }
        } catch (_: Exception) {
            // Malformed frames are dropped; the connection stays up.
        }
    }

    private fun onAuthed(frame: JSONObject) {
        val wsUrl = activeWsUrl ?: return
        val accessToken = frame.opt("accessToken") as? String ?: run {
            socket?.close(1008, "invalid authed frame")
            return
        }
        reconnectAttempt = 0
        // Keep the working endpoint first for this session and for the
        // boot-persisted list both.
        wsUrls = buildList { add(wsUrl); addAll(wsUrls.filter { it != wsUrl }) }
        remainingCandidates = wsUrls
        isChannelConnected = true
        connectedOrigin = originOf(wsUrl)
        guiAccessToken = accessToken
        DeviceChannelPlugin.persistGuiAccessToken(this, accessToken)
        DeviceChannelPlugin.notifyChannelState(true, connectedOrigin, accessToken)
        DeviceChannelPlugin.persistLastSuccessful(this, wsUrl)
    }

    private fun onRejected(frame: JSONObject) {
        val reason = frame.optString("reason")
        Log.w(TAG, "Device channel rejected: $reason")
        // The secret is invalid or revoked: retrying cannot succeed, the
        // user must re-pair on the phone.
        reconnectDisabled = true
        setChannelDisconnected()
    }

    private fun setChannelDisconnected() {
        val wasConnected = isChannelConnected
        isChannelConnected = false
        connectedOrigin = null
        guiAccessToken = null
        if (wasConnected) DeviceChannelPlugin.notifyChannelState(false, null)
    }

    private fun postAttentionFrame(frame: JSONObject) {
        val notification = frame.getJSONObject("notification")
        val kind = notification.optString("kind")
        val message = notification.optString("message", "Session needs attention")
        val sessionId = notification.optString("sessionId")
        postAttentionNotification(kind, message, sessionId)
    }

    private fun postAttentionNotification(kind: String, message: String, sessionId: String) {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val title = when (kind) {
            "turn-error" -> "Harness Remote — Error"
            "attention" -> "Harness Remote — Needs Attention"
            "turn-completed" -> "Harness Remote — Completed"
            else -> "Harness Remote"
        }
        val notificationId = if (sessionId.isNotEmpty()) (sessionId.hashCode() and 0x7fffffff) + 100 else 100
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(message)
            .setStyle(NotificationCompat.BigTextStyle().bigText(message))
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentIntent(openAppIntent(sessionId))
            .setAutoCancel(true)
            .build()
        manager.notify(notificationId, notification)
    }

    private fun scheduleReconnect() {
        if (stopRequested || reconnectDisabled) return
        val base = minOf(BACKOFF_CAP_MS, BACKOFF_BASE_MS * (1L shl reconnectAttempt.coerceAtMost(20)))
        // Jitter keeps a fleet of devices (or a flapping network) from
        // synchronizing their retry bursts.
        val jitter = (base * Random.nextFloat() * 0.5f).toLong()
        val delay = minOf(BACKOFF_CAP_MS, base + jitter)
        reconnectAttempt++
        cancelBackoff()
        backoffThread = Thread {
            try {
                Thread.sleep(delay)
            } catch (_: InterruptedException) {
                return@Thread
            }
            if (!stopRequested && !reconnectDisabled) {
                remainingCandidates = wsUrls
                tryNextCandidate()
            }
        }
        backoffThread?.start()
    }

    private fun cancelBackoff() {
        backoffThread?.interrupt()
        backoffThread = null
    }

    /** Network came back or Doze ended: cancel the pending backoff and reconnect now. */
    private fun triggerImmediateReconnect() {
        if (stopRequested || reconnectDisabled || isChannelConnected) return
        cancelBackoff()
        val stale = socket
        socket = null
        stale?.cancel()
        remainingCandidates = wsUrls
        tryNextCandidate()
    }

    /** The HTTP origin a channel WebSocket URL was built from. */
    private fun originOf(wsUrl: String): String =
        wsUrl.removeSuffix("/remote/device")
            .replaceFirst("ws://", "http://")
            .replaceFirst("wss://", "https://")

    /** Network availability/Doze receivers; idempotent across repeated starts. */
    private fun registerSystemCallbacks() {
        if (networkCallback != null) return
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            val callback = object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    triggerImmediateReconnect()
                }

                override fun onLinkPropertiesChanged(network: Network, linkProperties: LinkProperties) {
                    triggerImmediateReconnect()
                }

                override fun onLost(network: Network) {
                    socket?.close(1000, "network lost")
                }
            }
            try {
                cm.registerDefaultNetworkCallback(callback)
                networkCallback = callback
            } catch (_: Exception) {
                // Some OEM builds reject the registration; the backoff loop
                // still reconnects, just without the immediate trigger.
            }
        }
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                if (intent.action != PowerManager.ACTION_DEVICE_IDLE_MODE_CHANGED) return
                val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
                if (power.isDeviceIdleMode) {
                    // Doze entry: close in a controlled way; Doze exit
                    // reconnects immediately.
                    socket?.close(1000, "device idle")
                } else {
                    triggerImmediateReconnect()
                }
            }
        }
        ContextCompat.registerReceiver(
            this,
            receiver,
            IntentFilter(PowerManager.ACTION_DEVICE_IDLE_MODE_CHANGED),
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        idleReceiver = receiver
    }

    override fun onTimeout(startId: Int, fgsType: Int) {
        // Defensive: if a future platform applies a timeout to specialUse,
        // stop cleanly instead of being killed mid-notification.
        stopRequested = true
        stopSelf()
    }

    override fun onDestroy() {
        stopRequested = true
        cancelBackoff()
        networkCallback?.let { callback ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                try {
                    val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
                    cm.unregisterNetworkCallback(callback)
                } catch (_: Exception) {
                    // Registration never succeeded or the callback is already gone.
                }
            }
        }
        networkCallback = null
        idleReceiver?.let { receiver ->
            try {
                unregisterReceiver(receiver)
            } catch (_: Exception) {
                // Registration never succeeded or the receiver is already gone.
            }
        }
        idleReceiver = null
        socket?.close(1000, "service destroyed")
        setChannelDisconnected()
        super.onDestroy()
    }
}
