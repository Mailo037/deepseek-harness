# Agent Note: Electron 桌面应用（`dsh-electron`）

Status: implemented

[English](2026-08-21-electron-desktop-app.md) | 中文

## 问题

DeepSeek Harness 的 Web UI（`dsh web`）运行在浏览器标签页中，关闭标签页不会影响宿主进程——代理工作独立继续。桌面应用改变了这一预期：用户关闭窗口期待应用退出，而在代理步骤中途硬杀进程会丢失当前请求。仓库此前没有 Electron 打包、没有桌面生命周期，也没有窗口关闭与进程退出之间的宽限期。

## 决策

新增 `apps/electron` 包承载桌面应用。`apps/electron/src/host.ts` 通过 `@deepseek-ai/dsh-app-boot`（loadProfile、composeEntries、boot、watchUserPatches）引导与 `dsh web` 相同的 `web` 配置栈，但不使用 CLI 启动器的信号处理与进程退出设施。引导后的宿主运行在 Electron 主进程中，因此代理运行时与窗口外壳同进程——渲染进程崩溃只重新加载窗口，不中断代理工作。

Electron 主进程（`src/index.ts`）负责：

- **单实例锁**——`app.requestSingleInstanceLock()`；二次启动通过 `second-instance` 路由到运行中的实例。
- **关闭宽限**——`window-all-closed`（非 darwin）启动 `GraceTimer`（默认 5000 毫秒）。宽限期内宿主继续运行，代理持续工作。若用户在窗口期内重新打开应用（second-instance），宽限被取消并重建窗口——代理工作从未中断。若宽限到期，宿主关闭（会话刷写）并退出应用。
- **显式退出**——`before-quit` 立即关闭宿主。
- **渲染进程崩溃**——`render-process-gone` 重新加载窗口；宿主位于主进程，不受影响。

`src/grace.ts` 是纯 Node 的 `GraceTimer`（start/cancel/fire/dispose），无 Electron 依赖，用假定时器测试。

`src/smoke.ts` 是纯 Node 入口：引导宿主并打印 `ELECTRON_HOST_READY <url>`，随后在 stdin 收到 `q` 或 EOF 时关闭。宿主冒烟测试（`tests/host.spec.ts`）在子进程中启动该入口，使用一次性 `$DSH_HOME`，断言所服务的页面携带 `window.__DSH_BOOT__`，并验证干净关闭的退出码为 0。

应用使用操作系统分配端口（`--port 0`），绝不会与 3080 端口上的 `dsh web` 实例冲突。`$DSH_HOME` 下的设置、凭据、会话和 `web` profile 与 `dsh web` 共享——两边看到相同的对话。

## 备选方案

**Electron 作为薄封装，将 `dsh web` 作为子进程启动。** 首个版本否决：窗口关闭后宿主可以存活，但父进程硬崩溃会留下永远运行的孤儿宿主，且 Windows 上没有子进程信号可用于优雅关闭。进程内引导提供确定的生命周期控制和干净的 `ctx.fiber.dispose()` 关闭。

**按会话工作进程。** 最初的诉求是每个会话在独立 OS 进程中运行，应用关闭后存活 5 秒。此项推迟：当前代理循环在进程内运行，将会话迁移到工作线程或进程是更大的架构改动。应用级的 `window-all-closed` 宽限保护最常见的"关闭窗口"场景，而会话持久化（`$DSH_HOME/sessions`）在硬崩溃后于下次启动恢复对话。

## 影响

桌面应用可从仓库直接使用（`pnpm run dev:electron`）。5 秒宽限让代理在最后一个窗口关闭后有时间完成当前步骤，快速重新打开则无缝接续。硬崩溃或 SIGKILL 时，会话通过检查点策略持久化，下次启动显示相同对话。

`apps/electron` 携带与 `apps/cli` 相同的依赖闭包（全部 `@deepseek-ai/dsh-*` workspace 包），使 `healProfilesModuleFallback` 能把完整插件树链接进 `$DSH_HOME/profiles/node_modules`。Electron 二进制是 devDependency（`pnpm install` 下载约 100 MB）。

## 测试

- `tests/grace.spec.ts`——`GraceTimer` 配假定时器：配置窗口后触发、取消后不触发、重新 start 替换旧定时器、`fire()` 立即触发。
- `tests/host.spec.ts`——在纯 Node 子进程中启动 `lib/types/smoke.js`，使用一次性 `$DSH_HOME`，断言就绪行、所服务的页面（`window.__DSH_BOOT__`）以及干净关闭的退出码 0。超时：90 秒。
- Electron 冒烟模式（`DSH_ELECTRON_SMOKE=1`）打开窗口，等待 `did-finish-load`，打印 `ELECTRON_WINDOW_READY` 并退出——已在 Windows 上用真实 Electron 二进制验证。