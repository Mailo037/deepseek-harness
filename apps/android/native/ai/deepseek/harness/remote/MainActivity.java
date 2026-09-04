package ai.deepseek.harness.remote;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebSettings;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The DeviceChannel plugin lives in this app module (not an npm
        // package), so it is not in capacitor.plugins.json; register it
        // explicitly BEFORE the bridge is created.
        registerPlugin(DeviceChannelPlugin.class);
        registerPlugin(AppUpdatePlugin.class);
        super.onCreate(savedInstanceState);
        DeviceChannelPlugin.handleIntent(getIntent());
        // Make the WebView follow the system dark/light setting on Android 10
        // and 11 (API 29-30); from Android 12 the WebView follows
        // prefers-color-scheme automatically.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
            && Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            getBridge().getWebView().getSettings().setForceDark(WebSettings.FORCE_DARK_AUTO);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        DeviceChannelPlugin.handleIntent(intent);
    }
}
