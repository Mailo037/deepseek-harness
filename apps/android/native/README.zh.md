# 原生扩展

[English](README.md) | 中文

这里保存 Harness Remote App 的自定义原生部分。完整 Android 项目由 `npx cap add android` 生成（需要 Android SDK）；这些文件会复制到生成的项目中，使 App 保留 manifest 权限、前台通知服务、Capacitor 插件桥接与更新 `FileProvider`：

```
native/
  AndroidManifest.xml                       permissions + service declaration
  MainActivity.java                         plugin registration + force-dark WebView
  capacitor.plugins.json                    plugin registry (DeviceChannel + AppUpdate)
  app.build.gradle                          app module: Kotlin + app package version (copy → app/build.gradle)
  build.gradle                              root: Kotlin Gradle plugin (copy → build.gradle)
  ai/deepseek/harness/remote/
    DeviceChannelService.kt                foreground service (WebSocket + notifications)
    DeviceChannelPlugin.kt                 Capacitor bridge (start/stop/permission)
    AppUpdatePlugin.kt                     GitHub Release APK download + installer handoff
    ReleaseVersion.kt                      strict stable Android release-tag comparison
  res/xml/update_file_paths.xml            FileProvider cache allowlist
  test/ai/deepseek/harness/remote/          native JVM tests
```

生成项目后复制这些文件（CI 会自动执行）：

```sh
cd apps/android
pnpm cap add android
pnpm cap:sync
```

`scripts/sync-native.mjs` 会把这些文件复制到实际 Gradle 项目的源文件、资源、asset 与单元测试目录中。`build.gradle` 文件会应用 Kotlin 插件、从 `apps/android/package.json` 读取 App 版本，并为 WebSocket 与 Release 请求添加 OkHttp。每个后续 Release 都要在 `app.build.gradle` 中提升 `versionCode`。`capacitor.plugins.json` 会注册 App 本地插件；缺少条目时，桥接会报告该插件未实现。
