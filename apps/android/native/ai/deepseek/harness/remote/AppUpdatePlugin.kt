package ai.deepseek.harness.remote

import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.os.Build
import android.util.Base64
import androidx.core.content.FileProvider
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * Checks this repository's stable Android GitHub Release in the background,
 * then opens Android's package installer for a newer, same-signed APK. The
 * installer retains all user confirmation; no browser or GitHub activity is
 * launched. Any unavailable network or invalid release is an ignored update.
 */
@CapacitorPlugin(name = "AppUpdate")
class AppUpdatePlugin : Plugin() {

    @PluginMethod
    fun check(call: PluginCall) {
        if (!started.compareAndSet(false, true)) {
            call.resolve()
            return
        }
        Thread {
            try {
                AppUpdateChecker(context.applicationContext).checkAndOpenInstaller()
            } catch (_: Exception) {
                // Release checks are optional. Network, rate-limit, parsing,
                // storage, and installer failures leave the app usable.
            }
        }.start()
        call.resolve()
    }

    companion object {
        private val started = java.util.concurrent.atomic.AtomicBoolean(false)
    }
}

private data class ReleaseApk(val version: ReleaseVersion, val downloadUrl: String, val fileName: String)

/** Performs the trusted-release selection, APK validation, and install handoff. */
private class AppUpdateChecker(private val context: Context) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

    fun checkAndOpenInstaller() {
        val current = ReleaseVersion.parseStableTag("android-v${currentVersionName()}") ?: return
        val release = newestAndroidRelease() ?: return
        if (release.version <= current) return
        val apk = download(release) ?: return
        if (!isValidUpdate(apk, release.version)) {
            apk.delete()
            return
        }
        openInstaller(apk)
    }

    private fun newestAndroidRelease(): ReleaseApk? {
        val request = Request.Builder()
            .url(RELEASES_URL)
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", "Harness-Remote-Android")
            .build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) return null
            val body = response.body ?: return null
            val releases = JSONArray(body.string())
            var newest: ReleaseApk? = null
            for (index in 0 until releases.length()) {
                val candidate = releaseApk(releases.optJSONObject(index)) ?: continue
                if (newest == null || candidate.version > newest.version) newest = candidate
            }
            return newest
        }
    }

    private fun releaseApk(release: JSONObject?): ReleaseApk? {
        if (release == null || release.optBoolean("draft") || release.optBoolean("prerelease")) return null
        val tag = release.optString("tag_name")
        val version = ReleaseVersion.parseStableTag(tag) ?: return null
        val expectedName = "harness-remote-$tag.apk"
        val assets = release.optJSONArray("assets") ?: return null
        val asset = assets.firstMatching { it.optString("name") == expectedName } ?: return null
        val url = asset.optString("browser_download_url")
        if (!isOfficialReleaseAsset(url, tag, expectedName)) return null
        return ReleaseApk(version, url, expectedName)
    }

    private fun download(release: ReleaseApk): File? {
        val updateDir = File(context.cacheDir, UPDATE_DIRECTORY)
        if (!updateDir.exists() && !updateDir.mkdirs()) return null
        val destination = File(updateDir, release.fileName)
        val temporary = File(updateDir, "${release.fileName}.part")
        temporary.delete()
        val request = Request.Builder().url(release.downloadUrl).header("User-Agent", "Harness-Remote-Android").build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) return null
            val body = response.body ?: return null
            body.byteStream().use { input -> temporary.outputStream().use { output -> input.copyTo(output) } }
        }
        if (!temporary.renameTo(destination)) {
            temporary.delete()
            return null
        }
        return destination
    }

    private fun isValidUpdate(apk: File, expectedVersion: ReleaseVersion): Boolean {
        val packageInfo = context.packageManager.getPackageArchiveInfo(apk.absolutePath, signingFlags()) ?: return false
        if (packageInfo.packageName != context.packageName) return false
        if (installedVersionCode() >= packageVersionCode(packageInfo)) return false
        if (ReleaseVersion.parseStableTag("android-v${packageInfo.versionName}") != expectedVersion) return false
        return sameSigningCertificate(packageInfo)
    }

    private fun openInstaller(apk: File) {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", apk)
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, APK_MIME_TYPE)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        if (intent.resolveActivity(context.packageManager) != null) context.startActivity(intent)
    }

    private fun currentVersionName(): String? = context.packageManager.getPackageInfo(context.packageName, 0).versionName

    private fun installedVersionCode(): Long = packageVersionCode(context.packageManager.getPackageInfo(context.packageName, 0))

    @Suppress("DEPRECATION")
    private fun packageVersionCode(info: PackageInfo): Long = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode else info.versionCode.toLong()

    @Suppress("DEPRECATION")
    private fun signingFlags(): Int = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES

    @Suppress("DEPRECATION")
    private fun sameSigningCertificate(candidate: PackageInfo): Boolean {
        val installed = context.packageManager.getPackageInfo(context.packageName, signingFlags())
        return signingCertificateSet(installed) == signingCertificateSet(candidate)
    }

    @Suppress("DEPRECATION")
    private fun signingCertificateSet(info: PackageInfo): List<String>? {
        val signers = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.signingInfo?.apkContentsSigners else info.signatures
        return signers?.map { signer -> Base64.encodeToString(signer.toByteArray(), Base64.NO_WRAP) }?.sorted()
    }

    private fun isOfficialReleaseAsset(url: String, tag: String, fileName: String): Boolean = try {
        val parsed = url.toHttpUrlOrNull() ?: return false
        parsed.isHttps && parsed.host == "github.com" && parsed.encodedPath == "$RELEASE_ASSET_PATH$tag/$fileName"
    } catch (_: IllegalArgumentException) {
        false
    }

    private fun JSONArray.firstMatching(predicate: (JSONObject) -> Boolean): JSONObject? {
        for (index in 0 until length()) {
            val item = optJSONObject(index) ?: continue
            if (predicate(item)) return item
        }
        return null
    }

    companion object {
        private const val RELEASES_URL = "https://api.github.com/repos/Mailo037/deepseek-harness/releases?per_page=100"
        private const val RELEASE_ASSET_PATH = "/Mailo037/deepseek-harness/releases/download/"
        private const val UPDATE_DIRECTORY = "updates"
        private const val APK_MIME_TYPE = "application/vnd.android.package-archive"
    }
}
