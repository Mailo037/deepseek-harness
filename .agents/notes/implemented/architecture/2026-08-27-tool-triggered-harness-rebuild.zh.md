# Agent Note: 模型重新构建自己的 Web 宿主（`rebuild_harness`）

Status: implemented

[English](2026-08-27-tool-triggered-harness-rebuild.md) | 中文

## Problem

在 Web GUI 内修改 harness 的 agent（智能体）无法应用自己的源码变更：构建和重启宿主需要人工终端操作，会话运行期间重启还会终止后台任务，却不记录当时运行的任务。现有自更新流程（`host.applyUpdate`）面向浏览器，始终快进到上游，且不进入模型请求，因此模型无法请求“重新构建磁盘上的内容并返回”。

## Decision

模型通过一个工具 `rebuild_harness`（`@deepseek-ai/dsh-tool-rebuild`）重新构建并重启自己的 Web 宿主。它组合三项现有能力，而非新增重启机制：任务注册表负责安全终止任务，自更新服务负责让 agent 停稳并创建独立助手，启动器的 `ctx.appLifecycle.restart` 负责进程交接。助手计划支持 `pull: false`（`createWebUpdateHandoff(address, { pull: false })`），使同一运行器同时服务上游更新和只构建重启。构建仍在助手中执行，因为宿主必须先退出，`pnpm run build` 才能替换其正在执行的产物。

工具安排重启，但重启仅在调用 agent 的 `whenIdle()` 处触发，绝不在 `execute()` 内触发。这一顺序使任务记录持久：工具终止归属于调用者的运行中任务，等待各任务结算（受 `jobStopTimeoutMs` 限制），并在标准结果中返回任务列表；随后轮次结束并记录 `tool/result`，只有空闲回调才让所有 agent 停稳（`quiesceAgents`，保留 inbox）并交接。在 `execute()` 中重启会取消携带这份记录的轮次。

重启后通过 transcript（文本记录）重新驱动任务，而非引入新的运行时机制：日志结果列出所有已停止任务并要求模型重新启动，恢复的会话将该指令作为普通历史回放。工具在 `dsh-web-app` bundle 的宿主平面挂载，每个 Web 会话的 agent 均可见，因为重启影响整个进程。宿主缺少重启能力、`ctx.selfUpdate` 或 `ctx.webServer` 时，失败发生在调用阶段，而非加载阶段。

## Alternatives considered

- **在 `execute()` 内重启**虽然自包含，却会破坏自己的结果：轮次中途取消，任务列表无法进入日志，模型盲目恢复。空闲后重启的顺序是该设计的核心。
- **专用持久“待恢复任务”存储**（新增会话事件或文件）被否决，因为日志工具结果已经是模型读取的持久记录；第二份存储会重复信息并需要独立回放机制。
- **向模型开放 `host.applyUpdate`**会把模型与未经请求的 git pull 耦合。用户的流程是重新构建磁盘内容，因此工具固定 `pull: false`。

## Consequences

- 工具触发的重新构建只向浏览器表现为断线：GUI 更新覆盖层通过更新 store 跟踪 GUI 发起的更新，工具路径刻意绕过它。该限制记录于包 README，而未扩展覆盖层。
- 工具不列举无所有者或其他所有者的任务，因为注册表按所有者限制访问；这些任务仍通过 agent 停稳和注册表 dispose 安全结束，但不进入持久记录，只有调用 agent 的任务会被重新驱动。
- `verify-cordis-config` 验证 bundle 的依赖声明：工具条目的包是 `dsh-web-app` 的依赖。
