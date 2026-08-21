# @deepseek-ai/dsh-electron

[English](README.md)

## 为什么存在

在纯 Web 部署（`dsh web`）中，浏览器标签页只是宿主进程之上的一个视图；关闭标签页后进程继续运行，代理工作与页面无关。桌面应用改变了这一预期：用户关闭窗口即关闭应用，窗口关闭通常也意味着应用退出。`dsh-electron` 在最后一个窗口关闭后保留宿主进程一小段宽限期，因此快速重新打开可以精确接续运行，而真正的退出会干净地刷写会话，而不是在步骤中途杀死宿主。有关更多信息，请参阅 [Electron](https://www.electronjs.org/) 文档。

## 架构

```
Electron main process
├── bootWebHost()          the same web-profile stack `dsh web` boots,
│                          composed through @deepseek-ai/dsh-app-boot
│                          (bundles → profile layer → home layer)
├── BrowserWindow          loads http://127.0.0.1:<os-assigned port>
│                          (contextIsolation, sandbox, no nodeIntegration)
└── GraceTimer             window-all-closed → GRACE_MS → shutdown + quit
                           second-instance → cancel grace, recreate window
```

- 宿主（代理运行时）位于**主**进程中，绝不在渲染进程中。渲染进程崩溃只会重新加载窗口；代理工作继续运行。
- 应用使用**操作系统分配端口**（`--port 0`），因此绝不会与 3080 端口上的 `dsh web` 实例冲突。
- `$DSH_HOME` 下的会话、设置、凭据和 `web` profile 与 `dsh web` 共享——两边看到相同的对话。
- `DSH_ELECTRON_GRACE_MS` 环境变量可覆盖 5 秒默认值。

## 运行

```sh
pnpm run build          # builds packages + this app's lib/
pnpm run dev:electron   # tsc -b && electron .
```

桌面应用需要已构建的前端 dist（`apps/web/dist`），仓库构建会生成它。

## 生命周期约定

| 事件 | 行为 |
|---|---|
| 最后一个窗口关闭 | 启动宽限计时器（`DSH_ELECTRON_GRACE_MS`，默认 5000 毫秒）。窗口期间宿主继续工作。 |
| 宽限期内重新打开应用（第二个实例） | 宽限取消，窗口重建，代理工作从未中断。 |
| 宽限期到期 | 宿主关闭（会话刷写、持久化关闭），应用退出。 |
| 显式退出（菜单/OS） | 宿主立即关闭，然后退出。 |
| 渲染进程崩溃 | 窗口重新加载；宿主继续运行。 |

## 测试

```sh
pnpm --filter @deepseek-ai/dsh-electron run test
```

The host smoke test boots the real web profile in a plain-Node subprocess (the same boot path the Electron main uses, minus Electron), asserts the served page carries `window.__DSH_BOOT__`, and verifies the clean-shutdown path.

## 已知限制与后续工作

- **打包**（electron-builder 安装包、代码签名、自动更新）尚未接入；应用通过 `pnpm run dev:electron` 从仓库运行。
- **按会话进程**尚未实现：所有会话在一个宿主进程中运行于 Electron 主进程。宽限期保护窗口关闭场景；硬杀死整个进程仍会终止宿主（会话已持久化，因此下次启动时对话从最后检查点恢复）。
- **macOS** 按平台惯例在最后一个窗口关闭后保持应用存活；宽限计时器在那里不触发。
- **无托盘图标**：宽限期内所有窗口都关闭时，只能通过重新启动应用来触达它（单实例锁会路由到正在运行的实例）。
