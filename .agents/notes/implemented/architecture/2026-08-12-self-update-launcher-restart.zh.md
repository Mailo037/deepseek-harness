# Agent Note：自更新作为启动器拥有的重启，藏在环回线上平面之后

状态：已实现

[English](2026-08-12-self-update-launcher-restart.md) | 中文

## 问题

GUI 既无从得知它对话的是哪个构建，也没有一条从「存在更新」通向「应用正运行它」的路径。三个约束塑造了这次设计：

1. **代码在哪里。** 两个表面——`dsh web` 与 Electron 外壳——都从同一个 git 检出运行宿主（Electron 在其主进程中引导同一个 web profile）。这里没有安装器通道，因此下载 release 的更新器没有任何可安装之物；诚实的更新单元就是检出本身。
2. **谁可以终结进程。** 应用更新会杀死每个已连接客户端的宿主，并且必须中止进行中的代理回合。这至少与 settings/credential 平面一样特权，而后者已在 `dsh-client-connection` 中被钉在环回上。
3. **谁拥有进程替换。** 插件无法重生启动器：只有接好信号处理器与关闭控制器的入口知道如何安全退出，而 Electron 的重启（`app.relaunch()` + `app.exit`）与 Node 的分离 spawn 毫无共通之处。

## 决策

**一个更新平面、两个启动器、感知表面的重启、GitHub 优先的检查。** `dsh-host-self-update` 服务拥有仓库身份（`describe`）、带缓存的上游检查（`check`）、代理静默（`quiesceAgents`：以 `{ kind: 'user' }, keepInbox: true` 取消每个活跃回合，再在时限内排空）以及仅限快进的拉取。检查是 GitHub 优先的，因为部署的检出跟踪的是一个公开的 GitHub fork：github.com 远程经一次未鉴权的 Compare-API 请求应答（`HEAD...branch` → `ahead_by` + 最新提交），只有非 GitHub 远程才回退为 `git fetch`。网关的 host 领域通过既有线上协议暴露 check/apply；两个方法都加入环回栅栏，因为 apply 会为每个客户端终结进程，而 check 会让宿主发起网络请求。

进程替换是**启动器能力**，不是服务：`provideCmdline` 在 `appExit` 旁增加了一个可选的 `appRestart`。CLI 的接线是「弃置树 → 以相同 argv 分离重生 → 退出」；Electron 引导的接线是 `app.relaunch()` → 常规关闭。在该值缺席之处（嵌入宿主），`host.describe` 报告 `canRestart: false`，GUI 隐藏该手势而不是迟来失败。表面检测经 `process.versions.electron` 进入 `host.describe.surface`，让「关于」界面能说出自己运行于什么之上。

**时序住在线上处理器里，而不是浏览器里：** 静默 → 拉取 → 应答 ok → 把重生推迟 500 ms。先应答后调度使失败可上报；这段延迟让 ok 应答能在弃置之前冲刷出去。客户端一侧在 `UpdateStore.watchRestart` 中镜像了这一点：只有先见过一次失败的 `host.describe`（旧进程消亡）、随后一次成功的调用之后才重载——在关闭窗口内重载会再次落在旧构建上。

## 测试

`packages/host/self-update/tests/` 以脚本化 runner 覆盖 git 层（身份回退、失败分类、仅快进拒绝），并以携带 `.git` 的真实临时目录覆盖服务（缓存窗口、强制、静默顺序、拉取推进）。`packages/host/apiproxy/tests/api-proxy-host-update.spec.ts` 经结构化桩驱动线上方法：能力退化、错误码映射、「静默先于拉取」的顺序，以及恰好一次的调度重生。
