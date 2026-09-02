# Agent Note: Android GitHub Release APK 更新

Status: implemented

[English](2026-08-31-android-release-auto-update.md) | 中文

## Problem

Harness Remote 以 Android APK 分发，因此用户原本需要找到后续 GitHub Release、在浏览器中下载 asset，并在 App 外开始安装。该流程可能选择预发布版本、无关的 Release asset，或无法替换已安装 App 的 APK。Android 不允许普通 App 静默替换自身。

## Decision

应用启动时，`AppUpdatePlugin` 会向 `https://api.github.com/repos/Mailo037/deepseek-harness/releases?per_page=100` 发起一次尽力请求，并选择该页中最高的 Android 版本。它只接受已发布、非草稿、非预发布的 Release，标签必须严格为 `android-vMAJOR.MINOR.PATCH`，asset 必须严格为 `harness-remote-android-vMAJOR.MINOR.PATCH.apk`。asset URL 必须匹配该仓库、标签和文件名。`ReleaseVersion` 会比较全部三个数字部分，因此无关的桌面 Release 不会遮蔽 Android 更新，稳定更新也不会被误认为预发布版本或降级。

该 plugin 会将选定 asset 下载到 App 私有的 `cache/updates` 目录。在打开 installer 前，它要求 App package id、声明的 Release version、比已安装 APK 更高的 version code，以及与已安装版本完全匹配的签名证书。`FileProvider` 只向 `ACTION_VIEW` package-installer intent 暴露该缓存目录。Android 保留系统安装确认与任何所需的 unknown-source 授权；App 不会打开浏览器或 GitHub 页面，也不会静默安装。

Android `versionName` 来自 `apps/android/package.json`；`native/app.build.gradle` 保存单调递增的 version code。每个后续 Android Release 都会提升该 version code，同时保留签名证书。`scripts/sync-native.mjs` 会把原生源文件、资源、asset 与 JVM 测试复制到 Capacitor 生成的 Gradle 项目，Android workflow 调用同一个同步命令。

## Testing

`ReleaseVersionTest` 覆盖可接受的稳定标签、被拒绝的预发布与歧义标签，以及语义排序。Android Gradle unit test 会在生成项目中编译原生 updater；TypeScript 测试与 type check 覆盖启动 bridge。

## Alternatives considered

**在浏览器中打开 GitHub Release。** 否决：这会中断 App 内更新流程，并把 asset 选择留给浏览器下载路径。

**接受最新 Release 中的任意 APK asset。** 否决：该仓库还携带 Android 客户端以外的 Release；明确标签与文件名可以消除更新目标歧义。

**在预发布版本的数字更高时使用它。** 否决：稳定安装不应在没有明确 preview channel 的情况下迁移到预发布版本。

**使用 Android 静默安装。** 否决：普通第三方 App 没有该权限。系统 package installer 会验证安装并收集用户确认。

## Consequences

稳定 Android Release 有一条标签与 asset 命名规则，暂时的 GitHub 失败不会中断配对或远程 GUI。当 APK 的签名不同或 version code 相同或更低时，App 会拒绝 Release；Android 会呈现仍然需要的来源安装授权。密钥轮换或不同分发签名需要单独协调的迁移，因为 updater 有意拒绝它们。
