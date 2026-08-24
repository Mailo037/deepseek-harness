# @deepseek-ai/dsh-electron

[English](README.md) | 中文

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

## Windows 发行版

`pnpm --filter @deepseek-ai/dsh-electron run package:win` 会构建完整的官方客户端/运行时依赖图，然后在 `apps/electron/release/` 创建 NSIS 安装包。`package:dir` 创建同一 Windows 应用的解包版本，`smoke:package` 会在禁用更新器并使用隔离的首次运行主目录的情况下启动该应用，等待真实 Electron 窗口加载，并验证其干净退出。

`electron-builder.yml` 会打包已生成的 Electron 主进程树、随附的 agent preset、运行时依赖，以及由 `dsh-web-app` 通过 package export 解析的已构建 `@deepseek-ai/dsh-web-frontend` dist。Windows 可执行文件和安装包使用已提交的应用 id、产品名称和 `.ico` 图标。

Windows 签名的源代码不含凭据：electron-builder 只从受保护的 release workflow 环境发现 `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD`（或文档规定的 `CSC_*` 回退）。release workflow 包含常规的未签名打包/冒烟任务和单独批准、受 tag 约束的发布任务；它是仓库中唯一引用签名 secret 的配置。该任务会把 `electron-builder.yml` 所选 GitHub release 的 NSIS 安装包、blockmap 和更新元数据上传上去。

## 已安装应用更新

已安装的 package 会在启动时和每六小时检查一次已配置的 GitHub release feed。原生 Electron 更新器从不自动下载：它会显示检查状态，在有可验证签名的更新时提供下载，在活动窗口中显示传输进度，并且只在安装包下载完成后第二次明确提供“重启并安装”。关闭任一对话框都会让当前应用继续运行；`autoInstallOnAppQuit` 已关闭，因此之后的普通退出不能应用未经批准的下载。

这与既有 About 页面中的 Git checkout 更新器不同。checkout 更新仍保留其快进合并和宿主重启流程；已打包应用没有 checkout，所以其原生更新路径既不会启用也不会改变该服务。

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

`tests/updater.spec.ts` 固定更新器的两次明确批准和错误行为。`tests/distribution.spec.ts` 固定 NSIS、资源、签名验证和发布配置。`smoke:package` 是已构建产品的冒烟测试；它不会发布，也不会联系更新 feed。

## 已知限制

- **签名和发布需要 release 授权**：本地和常规 CI package 有意保持未签名并使用 `--publish never`；在可发行 release 签名并上传前，需要受信任的 Windows 证书和受保护的 release workflow。
- **更新验证需要已签名的 release**：Windows 更新下载已启用 `verifyUpdateCodeSignature`，因此未签名的本地安装包只能证明打包冒烟，不能证明更新通道。
- **按会话进程**尚未实现：所有会话在一个宿主进程中运行于 Electron 主进程。宽限期保护窗口关闭场景；硬杀死整个进程仍会终止宿主（会话已持久化，因此下次启动时对话从最后检查点恢复）。
- **macOS** 按平台惯例在最后一个窗口关闭后保持应用存活；宽限计时器在那里不触发。
- **无托盘图标**：宽限期内所有窗口都关闭时，只能通过重新启动应用来触达它（单实例锁会路由到正在运行的实例）。
