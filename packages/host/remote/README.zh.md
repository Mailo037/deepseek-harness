# @deepseek-ai/dsh-host-remote

[English](README.md) | 中文

Harness Web GUI 的远程设备平面：通过一次性二维码配对设备（Android 或任意 WebSocket 客户端），维护持久化设备注册表，向已连接设备推送会话提醒事件，并立即执行服务器端撤销。

浏览器通过 `device` Remote namespace（`ctx.remote.device.*`）控制该平面；设备直接在 `DEVICE_PATH`（`/remote/device`）上使用 WebSocket channel 协议。

## 语义

- **配对**——`pairingCreate()` 创建一次性 token（寿命由 `pairingTtlSeconds` 决定）以及携带端点列表的二维码 payload，先列出自动探测到的 LAN IPv4，再列出配置的 `endpoints`。设备把 token 作为首条 channel 消息提交；服务器回复包含 device id、device secret 与持久 GUI access token 的 `paired`，然后只持久化 SHA-256 secret hash。回复中返回 GUI 鉴权信息，使二维码与手动配对等效。
- **重连**——已配对设备提交其 secret（`auth`）；服务器替换同一设备的旧 socket，更新 `lastSeenAt`，并返回当前 GUI access token，使 App 能够修复陈旧的持久化鉴权状态。
- **GUI 鉴权**——每个非 loopback `/api` 请求都提交持久二维码 access token。注入的 index script 将 token 保存在 session storage，并把它提供给浏览器连接 carrier，用于 HTTP 与 WebSocket query 鉴权；cookie 仍作为同源浏览器的回退。
- **通知**——通知桥订阅 `session/event`，在 turn 以错误结束（`notifyOnError`）或完成（`notifyOnCompleted`）时向每个已连接设备广播 frame。通知文本用最新的持久化会话标题标识会话；标题尚不存在时回退到会话 id。
- **撤销**——`devicesRevoke()` 立即终止 live socket、删除注册表记录并使 secret 失效：该设备无法重连，必须重新配对。

## 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `endpoints` | `[]` | 追加在自动探测 LAN 端点之后的额外 authority（隧道地址、Tailscale 名称） |
| `pairingTtlSeconds` | `300` | 配对 token 的寿命，以秒为单位（10–86400） |
| `notifyOnError` | `true` | 在 `turn/end` 携带错误原因时广播 |
| `notifyOnCompleted` | `true` | 在 `turn/end` 携带完成原因时广播 |
| `printPairingQr` | `false` | 激活时向终端打印配对二维码 |

WebSocket channel 只在组合后的 `webServer` 绑定地址上可达。`dsh web` CLI 仍拒绝 `--host 0.0.0.0`；远程部署通过自定义 profile patch 的非 loopback 绑定或隧道访问 channel，且绝不能削弱浏览器信任围栏（`--trusted-host`）。

## Remote namespace（`device`）

- `pairingCreate()` → `PairingView`
- `devicesList()` → `RemoteDevicesSnapshot`（包含实时 `connected`）
- `devicesRevoke({ deviceId })` → `RevokeReceipt`

## 模型体验

无。该平面不注册面向模型的工具、提示词段或会话事件，只读取现有会话事件。

#### KV Cache 影响

无。

## 已知限制与待办工作

- **离线设备会错过通知**——广播只到达持有 live socket 的设备；设备重连后没有拉取遗漏 frame 的路径。
- **终端二维码只在启动时提供**——`printPairingQr` 在激活时打印一个配对码；浏览器界面（Settings → Remote）是交互式配对入口。
- **单 channel、单服务器**——没有多主机发现或自动隧道设置；二维码 payload 携带部署所配置的端点列表。
- **没有可视确认码**——配对只使用 token；计划中的设备侧 6 位确认码（类似 WhatsApp Web）留待后续实现。
- **没有逐设备通知过滤器**——广播发送给每个已连接设备。
