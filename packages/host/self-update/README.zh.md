# `@deepseek-ai/dsh-host-self-update`

[English](README.md) | 中文

基于 Git 的自更新服务（`ctx.selfUpdate`），面向从检出目录运行的 dsh Host：为 GUI 的「关于」界面提供仓库身份、上游更新检查、安全的代理静默与快进合并。重启本身由启动器的 [`ctx.appRestart`](../../boot/cmdline/README.zh.md) 能力完成——本服务只负责为它准备好工作树；线上接口位于 [API 网关](../apiproxy/README.zh.md) 的 host 领域（`host.checkUpdate`、`host.applyUpdate`）。

每一条 Git 事实都通过对配置工作树的一次无 shell `git` 调用读取（[native-command](../../util/native-command/README.zh.md)，`GIT_TERMINAL_PROMPT=0`）。不是检出的目录，或没有 git 的主机，都会降级为显式的不可用能力而不是加载失败——构建版安装本来就没有这两者。对 github.com 远程的更新检查只用一次公开的 Compare-API 请求（不经网络 git）；其他远程回退到 `git fetch`，而 apply/pull 仍然使用本地 git。检查按 `checkCacheMs` 缓存并与拉取串行化，因此两个客户端绝不会把两次网络步骤竞争进同一棵工作树；分叉的树以 `not-fast-forward` 拒绝，而不会改写本地历史。

配置：`root`（空 = 自动探测本包上方最近的 `.git`）、`commandTimeoutMs`（10 000）、`fetchTimeoutMs`（30 000）、`checkCacheMs`（60 000）。

## Model Experience

无；本包服务于浏览器侧设置界面，不会触及任何模型请求。

#### KV Cache 效应

无；本包既不组装也不发送任何提供方请求。

## Known Limitations and Deferred Work

- **apply 流程信任检出的干净程度** —— 只有当本地未提交的改动不与被更新的文件重叠时，它们才能在快进合并后幸存；在出现真实的冲突报告之前，脏树检测暂缓。
