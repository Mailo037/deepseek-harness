# Agent Note: 自更新作为启动器拥有的重启，藏在环回线上平面之后

Status: implemented

[English](2026-08-12-self-update-launcher-restart.md) | 中文

## 问题

GUI 既无从得知它对话的是哪个构建，也没有一条从「存在更新」通向「应用正运行它」的路径。三个约束塑造了这次设计：

1. **代码在哪里。** 两个表面——`dsh web` 与 Electron 外壳——都从同一个 git 检出运行宿主（Electron 在其主进程中引导同一个 web profile）。这里没有安装器通道，因此下载 release 的更新器没有任何可安装之物；诚实的更新单元就是检出本身。
2. **谁可以终结进程。** 应用更新会杀死每个已连接客户端的宿主，并且必须中止进行中的代理回合。这至少与 settings/credential 平面一样特权，而后者已在 `dsh-client-connection` 中被钉在环回上。
3. **谁拥有进程替换。** 插件无法重生启动器：只有接好信号处理器与关闭控制器的入口知道如何安全退出，而 Electron 的重启（`app.relaunch()` + `app.exit`）与 Node 的分离 spawn 毫无共通之处。

## 决策

**一个更新平面、两个启动器、感知表面的重启、GitHub 优先的检查。** `dsh-host-self-update` 服务拥有仓库身份（`describe`）、带缓存的上游检查（`check`）、代理静默（`quiesceAgents`：以 `{ kind: 'user' }, keepInbox: true` 取消每个活跃回合，再在时限内排空）以及仅限快进的拉取。检查是 GitHub 优先的，因为部署的检出跟踪的是一个公开的 GitHub fork：github.com 远程经一次未鉴权的 Compare-API 请求应答（`HEAD...branch` → `ahead_by` + 最新提交），只有非 GitHub 远程才回退为 `git fetch`。网关的 host 领域通过既有线上协议暴露 check/apply；两个方法都加入环回栅栏，因为 apply 会为每个客户端终结进程，而 check 会让宿主发起网络请求。

进程替换由启动器持有，并经始终存在的 `appLifecycle` 服务穿过插件隔离：`provideCmdline` 提供 `exit` 和可选的 `restart`。普通重启保留「dispose（资源释放）树 → 以相同 argv 分离重生 → 退出」，交接请求则携带一个不经 shell 的辅助进程命令。CLI 会先启动该辅助进程，只有操作系统确认 spawn 后才开始 dispose；辅助进程必须等父进程退出后才能接管其资源。Electron 忽略辅助进程形式，保留 `app.relaunch()` → 常规关闭。嵌入宿主没有 `restart` 时，`host.describe` 报告 `canRestart: false`，GUI 隐藏该手势而不是迟来失败。表面检测经 `process.versions.electron` 进入 `host.describe.surface`，让「关于」界面能说出自己运行于什么之上。

**Web 更新会在修改检出之前转移所有权：** 完全停稳 → 创建分离交接 → 应答 `{ started: true }` → 把交接推迟 500 ms。辅助进程等待旧宿主释放其权威端口，在该端口提供 `GET /__dsh_update/status`，运行 `git pull --ff-only`，运行 `pnpm run build`，释放状态 server，再以原有 Web 参数加保留的 `--port` 与 `--no-open` 运行 `pnpm dsh`。旧宿主绝不会 pull 自身源码，辅助进程 spawn 失败时旧宿主仍继续提供服务。当 `npm_execpath` 是原生可执行入口（`.exe`/`.cmd`/`.bat`）时，runner 直接启动捕获的 pnpm 入口，否则使用 `node <entry>`，因此构建与重启均支持 Windows 独立 pnpm 安装（见[原生 pnpm 启动](../bug-fix/2026-08-25-self-update-native-pnpm-launch.zh.md)）。Electron 保留「完全停稳 → 进程内快进 → 应答 → 原生重启」，因为其应用所有者提供更新 UI 和生命周期。

设置客户端通过布局的 `shell.overlay` slot 拥有浏览器投影，并把它的全屏占位者 portal 到 `document.body`，因此已经打开的设置模态框无法遮住它。发起标签页会在断线前显示**正在应用更新**；其他所有打开的标签页会在重连期间发现同 origin 状态 endpoint。runner 阶段映射成本地化的等待、拉取、构建、启动或失败文案，旁边的自动滚动终端保留最近 80 条有界 stdout、stderr 与 runner 日志。替换宿主连接后，每个标签页都用一次 `__dsh_update=<update-id>` 查询导航，以避开陈旧的 index 响应，然后在加载后从浏览器历史中移除该标记。runner 失败时会保留端口与状态响应，因此页面会显示错误，而不是回到普通的连接丢失界面。它还会提供一个预填的 GitHub issue 草稿，其中包含经 token 与主目录路径自动脱敏后的有界日志尾部；用户会在公开提交前审阅草稿。

## 测试

`packages/host/self-update/tests/` 以脚本化 runner 覆盖 git 层，并固定重启 argv 归一化。`packages/host/apiproxy/tests/api-proxy-host-update.spec.ts` 分开原生 pull／relaunch 与 Web 交接，并证明 Web 宿主不会在进程内 pull。CLI 与 cmdline 类型检查固定「spawn 先于 dispose」请求。客户端测试验证 runner 载荷拒绝、有界构建日志投影、issue 草稿脱敏和用于避开缓存的刷新 URL；完整组装 Web 快照拥有可见更新 transcript（文本记录）。

## 备选方案

**在运行中的宿主内 pull 和 build，然后重生。**不予采纳，因为 `git pull` 可能替换仍拥有关闭流程的进程所使用的代码与构建输入。如果该进程退出或其 pull 后路径失败，就不再有独立所有者负责重新构建或重新绑定端口。

**让浏览器运行 git 和 pnpm。**不予采纳，因为浏览器不拥有宿主子进程权限或生命周期关闭，而让它构造命令会把环回 API 扩大到有界更新操作之外。

**不设临时状态 server，只显示估算进度。**不予采纳，因为所有非发起标签页都只能看到连接丢失，发起标签页也无法区分缓慢构建与 runner 失败。保留的同 origin 端口让每个页面都能观察同一项更新状态，且无需再暴露一个端口。

**以原有浏览器打开标志重启。**不予采纳，因为更新不能再打开一个浏览器窗口。runner 保留调用，但使解析后的端口与 `--no-open` 成为权威值。

## 后果

Web 自更新现在要求通过 pnpm 启动的 git 检出，因为分离 runner 使用当前 pnpm 入口（原生可执行文件直接启动，其他入口通过 `node` 启动）完成构建与重启；拒绝发生在正在运行的宿主关闭之前。runner 在 pull 和 build 全程占用原端口，因此断线期间其他进程无法抢占它。失败的更新会有意让该状态 server 保持存活，并在暴露有界诊断与可审阅的 issue 草稿后要求用户介入。终端报告观察到的命令输出，而不估算 git 字节或编译器的逐项完成度。每个打开的页面都会在恢复后执行一次避开缓存的导航，Electron 则保留其原生更新器行为。
