# Agent Note: Electron 首次运行更新器导入

Status: implemented

[English](2026-08-24-electron-first-run-cjs-updater.md) | 中文

## 问题

Electron main 入口把 `autoUpdater` 当作 ESM 命名导出从 CommonJS 包 `electron-updater` 导入。Electron 的原生 ESM loader 在 `app.whenReady()` 之前拒绝该导入，因此全新的源码或打包启动都无法创建 host 或窗口。构建产物冒烟测试随后一直等待 readiness 行，直到 workflow 超时把 loader 错误掩盖成普通失败。

源码冒烟测试还会在 Windows 上直接启动 `npx.cmd`。当前 Node 的进程启动会以 `EINVAL` 拒绝这种命令形式，因此本地复现路径在 Electron 暴露应用错误之前就已失败。

## 决策

通过默认导入加载 CommonJS namespace，并仅在创建已安装包更新器时读取 `autoUpdater`。冒烟模式仍禁用更新检查，因此首次运行验证不会初始化更新器 singleton。

冒烟启动器通过当前 Node 可执行文件调用已解析的 Electron JavaScript CLI，并为每次运行提供隔离的临时 `DSH_HOME`。窗口 readiness 跟随 `loadURL()` promise；加载被拒绝时，冒烟模式会以明确失败关闭。

## 考虑过的替代方案

**把 `electron-updater` 打包进 main 入口。** 这可能掩盖模块格式不匹配，却会让打包过程负责重写依赖语义，并扩大应用自有输出。

**保留命名导入并更改 TypeScript interop 设置。** 类型检查已经接受原源码；失败发生在 Electron 的运行时 ESM loader。编译器开关无法让 CommonJS 包提供原生命名导出。

**冒烟运行继续使用用户真实 home。** 这会使打包检查依赖既有 profile、凭据和会话状态。隔离 home 可证明受支持的首次运行路径，并避免修改用户数据。

## 验证

Electron 包测试覆盖更新行为和发行配置。源码冒烟测试在 Windows 上启动真实 Electron main 入口，从空临时 home 启动 web host，加载浏览器 UI，打印 `ELECTRON_WINDOW_READY`，并成功退出。

## 后果

全新桌面启动不再在模块实例化期间失败。本地和 CI 冒烟运行会检验相同的首次运行 home 状态，窗口加载失败也会变成明确错误，而不是等待外层超时。
