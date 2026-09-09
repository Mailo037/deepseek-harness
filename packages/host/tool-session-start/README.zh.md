# `@deepseek-ai/dsh-tool-session-start`

[English](README.md) | 中文

面向模型的 `create_session` 工具：在当前宿主上、调用方会话的项目内开启一个新的空聊天。工具从调用方推导目标——登记的工作区（ accounted 该会话）或其记录的 cwd——沿用调用 agent 的 preset 组合，并在创建任何内容之前先走审批环节，由用户确认每一次新聊天的诞生。创建本身走宿主网关的 `session.create` 路径，浏览器与其他会话一样通过 `host/session-added` 流得知新聊天，因此不存在第二条创建路径。

子代理会话永远无法调用该工具：只有顶层聊天才能开启新聊天。两次获批的调用按调用顺序串行执行。工具既不向新聊天发送首条消息，也不切换用户视图；只回报稳定身份字段（session id、cwd、preset、工作区来源）供模型转述。

## 模型体验

### 工具 Schema

#### 模型可见内容

工具可见时的生成 [`create_session` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-session-start)。

#### Token 影响

工具可见的每次请求都有固定 Schema 成本。

#### KV 缓存影响

工具定义及可见性不变时前缀稳定。

### 创建结果

#### 模型可见内容

每次调用返回一个结果块，包含新聊天的 id、工作区路径及已组合的 preset，并要求模型告知用户可在侧边栏打开聊天，不得声称用户正在查看它。

#### Token 影响

结果块留在父会话历史中直到压缩；每次调用的长度为常量。

#### KV 缓存影响

仅追加；结果位于可复用的请求前缀之后，不使现有条目失效。

## 已知限制与暂缓事项

- **仅 Web bundle 挂载** — shipped 的 web-app patch 挂载该工具；需要的 CLI/TUI profile 自行组合该行。工具依赖 `ctx.apiProxy`，没有网关的部署在调用时失败。
- **审批强制** — 未组合审批服务的部署直接拒绝调用，而不是静默创建。
- **不投递首条消息** — 网关的创建路径没有 prompt 参数；用户打开聊天后自行写下第一条消息。
