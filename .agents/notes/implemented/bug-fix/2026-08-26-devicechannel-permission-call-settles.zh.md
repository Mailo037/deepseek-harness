# Agent Note: DeviceChannel 权限调用必须总是落定

Status: implemented

[English](2026-08-26-devicechannel-permission-call-settles.md) | 中文

## 问题

手机端配对早已在主机侧成功，App 却永远停在 "Connecting…"，而且系统的权限对话框从未出现过。根因：`ensureNotificationPermission()` 桥接到 `DeviceChannelPlugin.setNotificationPermission`，后者调用了 Capacitor 的 `requestPermissionForAlias("notifications", call, "notificationsPermissionDenied")`，而插件并未在该别名上声明任何权限。Capacitor 8 中（`com.getcapacitor.Plugin#requestPermissionForAliases`），若某别名的 `@Permission(strings=...)` 解析结果为空，代码会在任何 launcher 查找之前短路返回，导致这个 `PluginCall` 既不被 resolve 也不被 reject。于是 JS 侧 Promise 永远悬起，`ScanScreen.startPairing` 在它之后才清除 `loading`，界面无法离开 "Connecting…"——尽管几秒前 WebSocket `pair` 握手已经把设备写进了主机。第一个缺陷后面还藏着第二个：`saveConfig` 跑在这些原生调用之前，强杀 App 会留下一份已保存的配置，下一次点 Connect 就会把已被消费的一次性令牌发给一个永久拒绝的服务器。

## 决策

`DeviceChannelPlugin` 现在其 `@CapacitorPlugin(permissions = [...])` 注解上以别名 `NOTIFICATIONS` 声明 `POST_NOTIFICATIONS`，已授权时直接快速返回，并把请求路由到标注 `@PermissionCallback` 的 `onNotificationsPermission` 方法——无论用户允许与否都 resolve。拒绝时不报错而是照常落定是有意的：GUI、前台服务、通道鉴权都不依赖 `POST_NOTIFICATIONS`；被拒可能让提醒横幅静音，但不能让已配对设备失效。`android/app/src/main/java/...` 下的生成工程副本与 CI 会覆盖其上的 `native/` 记录源保持字节级一致（见 `apps/android/native/README.md`）。配对导航不再等待该调用；其顺序由 [Android 配对先提交，再进行可选通知设置](2026-08-30-android-pairing-commits-before-notification-setup.zh.md) 规定。

## 已否决的替代方案

**用户拒绝时 reject 该调用。** 否决：主机侧配对早已完成，为一个只影响横幅的功能让整条流程失败，换来的是一个看似永久的死局（重试必然撞上已消费的一次性令牌），反馈再严格也没人需要。

**直接调用 `ActivityCompat.requestPermissions` 并处理 `onRequestPermissionsResult`。** 否决：重复实现 launcher 登记、请求码与回调生命周期，而这些只要满足别名/回调契约，Capacitor 都已替我们管理。

**给 `plugin.setNotificationPermission` 包一层 JS 超时。** 否决：用一个任意计时器掩盖调用永不落定的缺陷，并且给未来每一个新别名埋下同样的雷。

## 后果

- DeviceChannel 权限调用会确定性落定，而配对正确性不再依赖其完成。
- 拒绝通知权限的用户得到一个完全可用但横幅静音的应用；正向行为与这条负面保证同时记录在插件 JSDoc 与本笔记中。
- 未来新增的权限别名必须同时出现在注解和某个 `@PermissionCallback` 方法里：漏掉任何一边都会复现静默跳过变体（无对话框、调用永不落定），而不是崩溃。

## 测试

TypeScript 应用编译干净，原生记录源与生成工程副本保持字节级一致，已声明别名与权限回调共同锁定 Capacitor 调用图。Android 模拟器测试在通知权限对话框尚未完成前就到达已连接界面；预授权路径覆盖完整的配对、持久化、断开、清除与错误流程。
