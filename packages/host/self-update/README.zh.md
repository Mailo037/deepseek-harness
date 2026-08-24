# `@deepseek-ai/dsh-host-self-update`

[English](README.md) | 中文

基于 Git 的自更新服务（`ctx.selfUpdate`），面向从检出目录运行的 dsh Host：为 GUI 的「关于」界面提供仓库身份、上游更新检查、安全的 agent（智能体）完全停稳、快进合并与 CLI（命令行界面）Web 更新器交接。`createWebUpdateHandoff()` 会捕获仓库、当前父进程、权威 Web host／port、pnpm 入口、当前 CLI 参数及缓存的 GitHub Issue 目标。启动器的 [`ctx.appLifecycle.restart`](../../boot/cmdline/README.zh.md) 会在关闭前启动分离的辅助进程；辅助进程等待父进程释放端口，在该端口通过 `GET /__dsh_update/status` 提供当前阶段及最近 80 行有界 stdout／stderr，运行 `git pull --ff-only` 和 `pnpm run build`，然后以原有 Web 参数、保留的 `--port` 与 `--no-open` 运行 `pnpm dsh`。线上方法位于 [API 网关](../apiproxy/README.zh.md) 的 host 领域（`host.checkUpdate`、`host.applyUpdate`）。

每一条 Git 事实都通过对配置工作树的一次无 shell `git` 调用读取（[native-command](../../util/native-command/README.zh.md)，`GIT_TERMINAL_PROMPT=0`）。不是检出的目录、没有 git 的主机，或不是通过 pnpm 启动的检出，都会让 apply 明确失败，而不会终结正在运行的宿主。对 github.com 远程的更新检查只用一次公开的 Compare-API 请求（不经网络 git）；其他远程回退到 `git fetch`。检查按 `checkCacheMs` 缓存并与进程内 pull 串行化，因此两个客户端绝不会把两次网络步骤竞争进同一棵工作树；服务 pull 与分离 runner 都拒绝非快进历史。

配置：`root`（空 = 自动探测本包上方最近的 `.git`）、`commandTimeoutMs`（10 000）、`fetchTimeoutMs`（30 000）、`checkCacheMs`（60 000）。

## Model Experience

无，因为本包服务于浏览器侧设置界面，不会触及任何模型请求。

#### KV Cache 效应

无；本包既不组装也不发送任何提供方请求。

## Known Limitations and Deferred Work

- **apply 流程信任检出的干净程度** —— 只有当本地未提交的改动不与被更新的文件重叠时，它们才能在快进合并后幸存；在出现真实的冲突报告之前，脏树检测暂缓。
