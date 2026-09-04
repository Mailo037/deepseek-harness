# Harness Remote — Android 精简客户端

[English](README.md) | 中文

DeepSeek Harness Remote 的 Android App（第 2 阶段）：提供二维码配对流程、PC 托管 Web GUI 的 WebView，以及持有到 PC `/remote/device` 通道持久 WebSocket 并在会话需要关注时发布 Android 通知的原生前台服务。

## 精简客户端约定

App **从不打包 Web GUI**。GUI 由 PC（`dsh --profile web`）提供，并在每次连接时通过全屏 iframe 重新加载——改进 GUI 不需要更新 App。APK 只包含：

1. **配对页面**——扫描二维码（Settings → Remote devices →「生成配对码」）或手动输入服务器 URL 与配对令牌；执行 `pair` 握手，并存储主机返回的设备密钥与 GUI 访问令牌。因此二维码与手动配对以相同方式认证嵌入式 GUI。
2. **已连接页面**——远程 GUI 的全屏 iframe，配有安静的状态栏、品牌加载器、连接丢失 UI（探测 + 重试按钮 + 10 秒自动重新探测 + 离线横幅）和连接详情弹层。每次 iframe 加载后，App 会通知其信息性 Android 外壳上下文；served GUI 在重连期间保持内容可见，并把实时连接状态报告回父页面。状态栏在 `Remote` 与 `Reconnecting` 之间纵向切换，而服务器 origin 在详情弹层中默认模糊并由 `Show` 控件遮盖。选中 Tailscale 端点时还会触发原生 Android VPN 传输检查，因此慢速加载和无法访问状态会提示用户何时启用 Tailscale。
3. **通知前台服务**（`DeviceChannelService`）——使用设备密钥认证的持久 WebSocket；为每个主机 `notification` 帧发布通知，在有会话标题时显示该标题，并通过退避机制重连。

本地配对与连接外壳直接导入 Web GUI 的 `ui-theme` base、design-platform 和 shadow/type token 样式表。因此 Android CSS 只负责组合与移动端人体工学：安全区域、页面过渡、主要触摸目标，以及紧凑的 40 px 已连接栏。配色方案、语义颜色、表面层级、边框、字体、阴影、圆角和动效时长都与 Web GUI 使用同一真源。可见标签保持句首字母大写形式。

## 目录布局

```
apps/android/
  src/                 App UI (React + Vite, built into dist/)
    PairingProtocol.ts Wire types + QR payload parsing (mirror of the host package)
    PairingService.ts  In-app pair handshake over WebSocket (reports stage progress)
    DeviceStorage.ts   Server URL, device secret, and GUI token persistence
    NotificationService.ts  Bridge to the native plugin, including Android VPN state
    AppUpdate.ts       Start the native GitHub Release APK update check
    ShellProtocol.ts    Versioned embedded-GUI connection-state parser
    ScanScreen.tsx     QR scan + manual pairing (swaps to the connecting flow on attempt)
    ConnectingScreen.tsx    Animated connecting flow: three steps, endpoint, cancel
    ConnectedScreen.tsx     Remote GUI iframe + status bar + connection-lost UI
    components/Brand.tsx    Logo mark + stroke icon set (currentColor, follows theme)
    systemBars.ts      Android status-bar style/background synced to color scheme
  native/              Custom native parts copied over the generated project
    AndroidManifest.xml  Permissions + service declaration
    ai/deepseek/harness/remote/
      DeviceChannelPlugin.kt   Capacitor bridge (start/stop/permission)
      DeviceChannelService.kt  Foreground service (WebSocket + notifications)
      AppUpdatePlugin.kt       GitHub Release APK download + installer handoff
      ReleaseVersion.kt        Strict stable Android Release tag comparison
  capacitor.config.ts  Capacitor configuration
  android/             Generated native project (NOT checked in; `cap add android`)
```

## 构建

前置条件：Node ≥ 22、pnpm，以及 [Android SDK](https://developer.android.com/studio)（已设置 ANDROID_HOME）。

```sh
# One-time: generate the native Android project from capacitor.config.ts
cd apps/android
pnpm install
pnpm cap add android
pnpm cap sync android

# Synchronize the checked-in native additions into the generated project.
pnpm cap:sync

# Build the debug APK
pnpm android:build
# → apps/android/android/app/build/outputs/apk/debug/app-debug.apk
```

`pnpm android:build:release` 构建发布 APK（签名不属于本仓库范围；请使用自己的 keystore）。

CI 会在每次推送到 `apps/android/**` 时构建调试 APK，并将其上传为工作流产物（[`.github/workflows/android-release.yml`](../../.github/workflows/android-release.yml)）。

## Release 更新

App 启动时会尽力请求 `Mailo037/deepseek-harness` 中的稳定 GitHub Release，并选择最新的有效 Android Release。只有当标签是 `android-vMAJOR.MINOR.PATCH`、含有名称完全匹配的 `harness-remote-android-vMAJOR.MINOR.PATCH.apk` asset，且该 asset 位于该标签的下载路径时，Release 才属于 Android 更新。草稿、预发布版本、格式错误的标签、缺失 asset、较旧或相同版本，以及失败或受 rate limit 限制的请求都会被忽略，不会阻塞配对或远程 GUI。

App 会把匹配的 asset 下载到私有缓存，检查其 package id、version code 与 Release version，并要求它使用已安装的签名证书。随后它会通过受限的 `FileProvider` URI 打开 Android package installer；不会打开浏览器或 GitHub。Android 仍控制安装器确认与任何所需的每个 App unknown-source 授权，因此 App 无法静默安装更新。Release APK 必须保持签名证书并使用更高的 Android version code。`versionName` 来自 `apps/android/package.json`；初始值为 `1` 后，每个后续 Release 都要在 `native/app.build.gradle` 中提升 `versionCode`。CI 工作流只上传 debug artifact；可安装的更新必须另外发布使用相同签名、且标签与 asset 名称匹配的 release APK。

## 开发工作流：一步完成构建与 LAN 服务

远程设备流程通常先构建 App，再提供 GUI 让手机访问（`dsh --profile web` 加 `--trusted-host`）。`dsh-dev` 辅助工具用一个命令完成两项工作：

```sh
pnpm dsh:web --trusted-host 192.168.1.5   # build the harness and web frontend, then serve the GUI on the LAN
pnpm dsh:web                              # --trusted-host defaults to the detected LAN IP
pnpm dsh:web --full                       # same complete build (optional)
pnpm dsh:web -- --profile web --port 3080 # extra flags after "--" pass through to dsh

pnpm dsh:build                            # typecheck + build the Android app web assets
pnpm dsh:build --apk                      # ... also sync Capacitor and build the debug APK
```

`dsh:web` 先运行 `pnpm build`，生成主机插件、客户端模块和 Web 前端，再启动 `pnpm dsh --profile web --trusted-host <ip>`。构建失败会阻止启动。除非显式传入 `--trusted-host`，否则会自动检测 LAN IP；每次调用都会构建全部必需产物，因此 `--full` 是可选的。执行 `pnpm install` 后，即使仓库中没有构建产物，也可以使用此命令。直接运行 `pnpm dsh web` 则需要先执行 `pnpm build`。

## 首次配对

1. 在 PC 上运行 `dsh --profile web`（如果通过 LAN 访问 GUI，请加入 `--trusted-host <LAN-IP>`）。
2. 在 GUI 中打开 **Settings → 远程设备 / Remote devices → 生成配对码 / Generate pairing code**。
3. 在 App 中选择 **Scan QR Code**——App 会按顺序尝试二维码载荷中的端点（先 LAN，再尝试已配置的额外端点），完成配对并进入 GUI。
4. App 会在存储配对配置后立即打开已认证 GUI。前台服务与 Android 通知权限随后启动；即使任一操作失败，也不会把 App 困在连接页面。主机会把 `turn-error`／`turn-completed` 通知推送给服务。

手动配对：输入服务器 URL（`192.168.1.5:3080`）和配对卡片中显示的令牌。

## 已知限制与暂缓工作

- `android/` Gradle 项目由 `npx cap add android` 生成；已检入的 `native/` 目录包含生成后必须覆盖过去的自定义源文件。CI 会自动执行此操作。
- App 不打包 Web GUI（精简客户端约定）。每次连接都会从 PC 重新把 GUI 加载到 iframe——只有配对外壳或原生能力需要 APK 更新。
- Android 13+ 会请求通知权限；如果用户拒绝一次，OS 设置页面是回退路径。
- GUI iframe 需要 PC 可达；WebSocket 通知独立于 iframe 继续工作（即使 App 进入后台，服务仍会运行）。
- 二维码扫描器使用 `capacitor-barcode-scanner`（相机权限）；完全自包含且不依赖 zxing 的扫描器属于后续工作。
- 主机的 `--trusted-host` 围栏必须包含 PC 的 LAN IP，App iframe 中的浏览器 API 调用才能成功。
- 前台服务使用 `specialUse` 前台服务类型（带 `PROPERTY_SPECIAL_USE_FGS_SUBTYPE`）：在 `targetSdk = 36` 下，`dataSync` 有 6 小时时限，并且不能从 `BOOT_COMPLETED` 启动。`BootReceiver` 会在设备重启后重启通道。重连会以指数退避扫描已存端点（1 秒基础、60 秒上限、抖动），并在网络恢复和退出 Doze 时立即重试。
- App 会存储二维码载荷中的每个端点及最后成功的 origin，并自动在它们之间回退——Wi-Fi ↔ 移动数据和 Tailscale 无需重新配对即可工作。如需通过 Tailscale 访问，请为主机配置 `--host 0.0.0.0` + `--trusted-host <TAILSCALE_HOST>`，并把 Tailscale 端点加入 `config.endpoints`。
- Tailscale 检测识别其 `100.64.0.0/10` IPv4 范围、`fd7a:115c:a1e0::/48` IPv6 范围和 `*.ts.net` 名称。Android 会报告是否有网络暴露 `TRANSPORT_VPN`；App 只把该事实用于连接指引，不会将其视作认证。
- 已认证前台通道在每次重连时返回当前 GUI 令牌。原生服务会把它直接写入 Capacitor Preferences，打开的已连接页面会周期性协调该原生状态，然后再重新加载 iframe。即使 WebView 错过通道事件，这也能修复陈旧令牌状态，无需清除 App 数据或重新配对。
- 应为 Tailscale（"Unrestricted"）和本 App（"Never sleep"）禁用电池优化，否则 Doze 会让 tailnet 连接和设备 WebSocket 中断数分钟。
