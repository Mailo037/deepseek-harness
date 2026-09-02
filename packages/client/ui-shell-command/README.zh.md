# @deepseek-ai/dsh-client-ui-shell-command

[English](README.md) | 中文

`!` shell 命令功能的 Web 客户端一半：仅裁决的 `!` 输入触发源、持久的 `shell-command` 会话节点及其终端卡片渲染器。与主机端 [`@deepseek-ai/dsh-shell-command`](../../shell/shell-command/README.zh.md) 服务配对使用。

## 客户端契约

`apply` 注册三个 effect 拥有的贡献：

1. 一个绑定到 `!` 触发符、名为 `shell` 的 [`InputTriggerSource`](../ui-input-trigger/README.zh.md)。触发检测器不会为 `!` 打开菜单；回车时的裁决会轮询该源，因为行以触发符开头。非空 `!` 行通过作用域 `slash/input-consume-token` bare-token 守卫被消费（composer 草稿清空）并分派到主机 `shellCommand.run` RPC。单独的 `!` 会作为普通消息落入默认 sink；带有图片附件的行会被拒绝并显示提示，草稿和图片保持在原位。
2. 一个 `shell-command` 类型的 `ConversationNodeDefinition`，将 `shell/run`/`shell/done` 生命周期折叠成一个聊天节点。
3. 键控的 `conversation.chat.node` 渲染器 `ShellCommandCard`，将折叠的生命周期渲染为 `TerminalBlock`——运行状态点、cwd、ANSI 彩色输出和退出状态徽章。

只有传输/接纳失败才会显示为 composer 提示；持久事件负责卡片呈现，因此失败的命令仍会提交 composer 草稿。

## 组合

随附的 `dsh web` bundle 挂载此插件；它需要主机 `shell-command` 行（并通过它需要一个已组合的 `ctx.shell` 执行器）以及 `ui-input-trigger`/`ui-conversation` 客户端插件。贡献 fiber 的销毁会移除全部三个贡献。

## 模型体验

### 直接人类 shell 命令

#### 模型看到什么

什么都没有。`!` 行由输入触发源拦截并在 shell 命令平面执行；命令文本及其输出都不会作为用户消息提交或以其他方式到达模型请求。`shell/run`/`shell/done` 事件仅用于日志，永远不会呈现给模型。

#### Token 影响

命令执行和 UI 输出不增加模型 token。

#### KV 缓存影响

命令行及其输出从不进入模型请求，不影响其缓存。

## 已知限制和待办工作

- **仅一次性前台执行**——每条 `!` 行都在全新进程中运行；命令之间不保留状态（cwd、变量、函数），`!` 行也不能启动后台任务。
- **无流式输出**——输出在命令结束时捕获并显示；长时间运行的命令在此之前显示为运行中。
