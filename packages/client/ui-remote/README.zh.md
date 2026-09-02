# @deepseek-ai/dsh-client-ui-remote

[English](README.md) | 中文

Web GUI 的远程设备设置分节：将引导式 Tailscale 设置交给会话 agent（智能体），生成一次性配对 QR 码，列出已配对设备及其连接状态，并立即撤销设备（终止 socket 并删除持久记录，不可撤销）。

该分节调用宿主 `device` Remote namespace（`@deepseek-ai/dsh-host-remote`）的 `pairingCreate`、`devicesList`、`devicesRevoke`、`accessTokenGet`。Tailscale 分组通过 sessions 接口向当前会话排入本地化设置任务（[dsh-tailscale-remote-setup skill](../../../.agents/skills/dsh-tailscale-remote-setup/SKILL.md) 的流程），关闭模态框并进入 agent 执行任务的对话。

## 注册

浏览器部分注册一个 `settings.section` 条目（`id: 'remote'`、`order: 15`），标签为“Remote devices”，在 `settings.remote` namespace 中提供 `zh`/`en` 本地化；还注册 fs-deny 条目（`id: 'fs-deny'`）。内容采用 Plugins 分节的 tablist 模式，分为配对码（含访问令牌）、已配对设备、Tailscale 设置三个标签。面板保持挂载，仅隐藏非活动内容，因此切换标签不会丢失配对状态和设备快照。

## 模型体验

### Tailscale 设置任务（用户消息）

#### 模型看到什么

用户点击设置操作时，一条本地化 `user/message` 排入当前会话。任务提示指定 `dsh-tailscale-remote-setup` skill 及其固定约束（tailnet 上使用明文 `http`，绝不使用 `tailscale serve`），并请求环境检查、profile patch 合并、验证和手机操作。完整文本归此包 `settings.remote` locale 字典的 `tailscalePrompt` 键所有；它是本地化产品文案，而非稳定系统提示词。该包不注册工具 schema 或系统提示词章节。

#### Token 影响

每次点击产生固定成本：一个携带任务文本、约数百 token 的用户轮次；agent 后续设置工作是由 agent loop（智能体循环）拥有的普通工具驱动轮次。

#### KV Cache 影响

只追加：任务文本作为普通用户轮次追加一次，像其他用户消息一样保留在 transcript（文本记录）中。再次点击会追加另一轮次；该包不会替换先前请求前缀，也不会发起独立模型请求。

## 已知限制与暂缓工作

- QR 码由客户端依据宿主配对 payload 生成（使用 `qrcode` 包）；payload 文本和 GUI 访问令牌隐藏在明确的显示/隐藏开关后，隐藏时仍可复制。
- 设备列表是时间点快照（挂载及每次撤销后加载）；向分节实时推送设备状态变更留待后续实现。
- Tailscale 交接针对当前会话，拒绝 subagent 路由；无法创建专用设置会话，因为目前没有获准的跨插件会话创建入口。
- 交接无法确认完成：宿主重启后（skill 的回退路径），只有用户返回会话时才会继续。
