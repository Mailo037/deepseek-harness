# Agent Note：Web GUI 的远程设备平面

Status: implemented

[English](2026-09-02-remote-device-plane.md) | 中文

## 问题

Web GUI 按设计绑定 loopback：`dsh --profile web` 会拒绝 `--host 0.0.0.0`，因为该界面能够执行远程代码，所有访问它的客户端都必须经过浏览器信任围栏。希望从手机驱动 agent 的用户此前没有受支持的路径：没有设备配对、没有会话提醒推送、无法撤销遗失设备，也没有管理界面。

## 决策

**设备平面挂载在 web profile 内，通过显式配对保护，而不是开放端口。** `@deepseek-ai/dsh-host-remote` 负责以下事项：

- **配对**：`pairingCreate()` 创建带可配置寿命的一次性 token，并返回含端点列表的二维码 payload。端点包括自动探测到的 LAN IPv4 与额外配置项。JSON payload 使用 `v: 1`，Android 客户端可按顺序尝试多个端点。
- **持久化注册表**：配对设备存入 `remote_devices` storage domain，包括 device id、名称、平台、SHA-256 secret hash、创建时间与最后在线时间。介质只接收 hash；invariant companion 拒绝任何不是 64 位十六进制摘要的 `secretHash`。
- **设备 channel**：`/remote/device` 的 WebSocket upgrade route 要求首条消息是 `pair` token 或 `auth` secret。配对创建记录并把 secret 交给设备；鉴权重连更新 `lastSeenAt`，同时返回当前 GUI access token，使已配对 App 无需重新配对即可修复旧 token。重连会替换同一设备的旧 socket，撤销会终止连接。
- **通知桥**：插件订阅 `session/event`，在 turn 出错或成功完成时向所有已连接设备广播 frame，两者均可配置。可见消息使用最新的持久化会话标题；标题尚不存在时回退到会话 id。离线设备不会补收消息；重连拉取留待后续实现。
- **GUI 鉴权**：二维码 payload 携带持久 GUI access token。Index script 将其保存在 session storage，发布到 `__DSH_REQUEST_AUTH__.query`，并设置同源回退 cookie。浏览器连接 carrier 会把 query token 附到 unary HTTP、Typert Remote 和两个 WebSocket downlink，因此 Android WebView iframe 不依赖第三方 cookie 策略。
- **Android shell 呈现**：GUI iframe 每次加载后发送带版本的 `postMessage` 公告。浏览器连接 service 将其暴露为信息性 shell context，使布局保留当前内容并显示紧凑重连状态，而不是普通全屏 overlay。Android 状态栏把服务器 origin 与断开操作放进显式详情控件。
- **共享视觉系统**：Android 配对和连接界面引入 Web 客户端的基础、设计平台、阴影与字体 token，复用语义表面、标签、边框、状态、字体、圆角、阴影和动效，同时保留 Android safe area 与 44/48 px 触控目标。

浏览器通过 `device` Remote namespace（`pairingCreate`、`devicesList`、`devicesRevoke`）读取并控制该平面，由 `@deepseek-ai/dsh-api-remotes` 挂载。`@deepseek-ai/dsh-client-ui-remote` 注册设置区“Remote devices”（id `remote`，order 15）：生成并复制二维码 payload、显示含在线状态的设备列表，以及立即撤销设备。撤销同时关闭 socket 并删除注册记录，不能撤销该操作。

**现有安全姿态保持不变。** `0.0.0.0` CLI guard、浏览器信任围栏与绑定 loopback 的特权方法都不变。Channel 只在组合后的 `webServer` 绑定地址上可达；远程部署仍需在 profile patch 中明确配置非 loopback 绑定或使用隧道。

## 测试

`packages/host/remote/tests/` 从四层覆盖该平面：配对单元测试、使用真实 storage-domain 机制的注册表测试、真实 HTTP 与 WebSocket channel 套件，以及挂载在真实 `WebServer`（`127.0.0.1:0`）上的 `RemoteGateway` 套件。它们覆盖一次性 token、拒绝、重连、通知、撤销、广播、基于标题的通知文本、id 回退，以及撤销后 socket 立即终止。客户端包包含 jsdom 组件测试与浏览器插件测试。

## 曾考虑的替代方案

**在 webserver 外使用独立端口。** 否决：第二个 listener 需要自己的 TLS/隧道方案，也无法继承 profile 绑定配置；现有 webserver upgrade registry 已负责 route 生命周期与清理。

**使用启动时配置的共享 secret。** 否决：该平面没有启动时 secret store，静态 secret 也不能按设备撤销；一次性配对与逐设备 secret 自然提供撤销能力。

**订阅 api-proxy 的会话摘要。** 否决：摘要是面向浏览器的投影，host 侧计算会让设备平面耦合 gateway；持久化的 `turn/end` 已提供同样提醒事实。

**在注册表保存设备 secret。** 否决：读取注册表就会泄露所有设备；hash 可保护介质，同时允许 channel 用一次 hash 查询鉴权。

**通过 pub/sub relay 推送离线通知。** 否决，属于第一阶段范围扩张；当前 channel 以连接为作用域，离线策略留给后续 Android 阶段。

**仅依赖 SameSite cookie 鉴权 GUI。** 否决：Android App 在 Capacitor origin 下嵌入 PC 提供的 GUI，WebView 可能在 WebSocket upgrade 时忽略第三方 iframe cookie。显式 query 鉴权让每个浏览器 carrier 复用相同服务器 token 检查。

**把 Android shell 公告当成鉴权。** 否决：`postMessage` 只是可被其他嵌入页面仿造的呈现提示。API 授权仍只依赖 GUI access token 与现有信任检查。

**正常流程中显示服务器 origin 与全屏重连 overlay。** 否决：origin 是诊断信息，不是首要任务；临时恢复期间全屏 overlay 会遮挡仍可使用的会话内容。连接详情仍可按需打开，持久状态控件负责传达恢复进度。

## 后果

设备平面让已配对手机访问 Web GUI，同时保留逐设备 channel 撤销和独立持久 GUI token。显式鉴权启用时，浏览器请求 URL（包括两个 WebSocket upgrade URL）会携带该 token，因此部署必须把 access log 视为敏感数据。经鉴权的 channel 重连会从原生前台 service 直接刷新 App 中保存的 GUI token，连接页面打开时也会协调权威原生状态，避免 token 轮换、漏收 WebView 事件或旧 App 状态导致 iframe 永久重连。Session storage 让已鉴权 iframe 在文档 reload 后保持连接，关闭 tab 则丢弃 token。Cookie 仍支持普通同源浏览器，但 Android 正确性不依赖 WebView cookie 策略。Shell 公告只改变呈现：Android 用户在重连时保留现有内容并按需查看详情，普通浏览器行为不变。
