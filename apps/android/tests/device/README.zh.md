# 设备测试通道——模拟 PC 与真实模拟器

[English](README.md) | 中文

在真实 Android 模拟器上端到端检查应用 UI，PC 侧由零依赖 Node mock 扮演。测试程序通过 Chrome DevTools Protocol 驱动应用的 Capacitor WebView，并断言用户可见界面；判断结果无需截图，截图仅作为供人工审阅的产物保存。

## 组件

```
tests/device/
  mock-pc-server.mjs  Simulated PC: fake GUI (iframe target) + /remote/device
                      WebSocket pairing handshake (minimal RFC 6455 server)
  run-smoke.mjs       CDP driver: phases of the app flow with DOM assertions
```

模拟 PC 实现 `src/PairingProtocol.ts` 的通信协议（`pair` → `paired{deviceId,secret,accessToken}`、`auth` → `authed{deviceId,accessToken}` 或 `rejected{reason}`）。`GET /__status` 返回 `{pairs, auths, rejects, guiRequests, authenticatedGuiRequests, shellMessages}`，供测试程序断言服务端效果。

## 前提条件

- 带模拟器系统镜像的 Android SDK，已设置 `ANDROID_HOME`。
- 一个 AVD（任意较新镜像；此通道使用 `Medium_Phone` / API 37 x86_64 开发）。
- Node ≥ 22（内置 `WebSocket` 和 `fetch`）；Gradle 使用 JDK 21+。

## 运行

```pwsh
# 1. Boot the emulator (any working AVD name)
& "$env:LOCALAPPDATA\Android\Sdk\emulator\emulator.exe" -avd Medium_Phone `
  -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect -no-snapshot

# 2. Start the simulated PCs (fast + slow-for-cancel)
node apps/android/tests/device/mock-pc-server.mjs --port 31223 --token TESTTOKEN123
node apps/android/tests/device/mock-pc-server.mjs --port 31224 --token SLOWTOKEN --latency 8000

# 3. Build and install the app (from apps/android)
pnpm build; pnpm exec cap sync android
cd android; .\gradlew.bat assembleDebug
adb install -r app\build\outputs\apk\debug\app-debug.apk

# 4. Pre-grant the notification permission so the full smoke runner keeps its
#    DevTools connection while the system dialog would own the foreground.
#    Pairing itself no longer waits for this permission.
adb shell pm grant ai.deepseek.harness.remote android.permission.POST_NOTIFICATIONS
adb shell am start -n ai.deepseek.harness.remote/.MainActivity

# 5. Forward the WebView devtools socket and run the phases
$socket = adb shell cat /proc/net/unix | Select-String webview_devtools_remote | ForEach-Object { ($_ -split '@')[1].Trim() }
adb forward tcp:9223 localabstract:$socket
node apps/android/tests/device/run-smoke.mjs --phase pairing-happy
node apps/android/tests/device/run-smoke.mjs --phase seed-stale-token
adb shell am force-stop ai.deepseek.harness.remote
adb shell am start -n ai.deepseek.harness.remote/.MainActivity
node apps/android/tests/device/run-smoke.mjs --phase persisted      # after force-stop + relaunch
node apps/android/tests/device/run-smoke.mjs --phase disconnect
adb shell am force-stop ai.deepseek.harness.remote
adb shell am start -n ai.deepseek.harness.remote/.MainActivity
node apps/android/tests/device/run-smoke.mjs --phase cleared
node apps/android/tests/device/run-smoke.mjs --phase errors
```

每个阶段逐项打印 `PASS`/`FAIL`，失败时以非零状态退出。截图保存到 `.artifacts/android-device/`。

## 各阶段验证的内容

| 阶段 | 验证内容 |
|---|---|
| `pairing-happy` | 启动页 → 平面手动表单 → 三步连接流程 → 已连接：紧凑状态栏、绿点、已鉴权 iframe 加载模拟 GUI；mock 收到配对握手 |
| `seed-stale-token` | 用截断值替换已存储 GUI 令牌，以设置重连回归场景 |
| `persisted` | 重启跳过配对，恢复已连接界面，并通过原生通道刷新过期 GUI 令牌 |
| `disconnect` | 断开连接清除状态并返回配对 |
| `cleared` | 断开后重启展示配对界面，不残留配置 |
| `errors` | 错误令牌 → 显示服务端原因；宿主不可达 → 显示不含内部术语的提示；慢握手期间取消 → 返回表单，不显示错误提示 |

## 已知限制

- 不覆盖 QR 路径，因为模拟摄像头无法可靠显示可扫描码；手动配对驱动同一个 `PairingService` 流程。
- 通过 CDP 截取 WebView 只捕获应用内容，不含系统栏；完整设备截图使用 `adb exec-out screencap -p`。
- 模拟器冷启动需数分钟，各阶段间应保持运行。
