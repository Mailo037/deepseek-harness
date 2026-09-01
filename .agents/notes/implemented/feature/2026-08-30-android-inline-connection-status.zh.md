# Agent Note: Android 行内连接状态与私密端点详情

Status: implemented

[English](2026-08-30-android-inline-connection-status.md) | 中文

## Problem

Android 外壳与嵌入式 Web GUI 各自渲染一个连接指示器。只有 iframe 知道事件 WebSocket 的状态，因此 Web GUI 的指示器浮在会话内容之上；Android 顶栏只知道 HTTP 探测是否触达服务器。眼睛控件一打开，连接详情还会立即暴露完整服务器 origin，而失败的 Tailscale 路径得到的建议与失败的 LAN 路径相同。

## Decision

浏览器连接服务在接受 Android 外壳通知后，以及每次 `connected`／`reconnecting` 切换时，发送带版本的 `{ type: "dsh/client-connection-state", version: 1, state }` 消息。Android 父页面只接受来自当前 iframe window 且符合预期 GUI origin 的报告。该消息仅提供信息并改变展示；请求认证仍依赖 GUI 访问令牌。

Android 顶栏是唯一的连接指示器。固定高度的标签视口在 `Remote` 与 `Reconnecting` 之间移动一个 18 px 步长，两个标签同时按 Web 主题的时长与缓动 token 交叉淡化；减少动态效果偏好会收束这些过渡。AppFrame 在 Android 重连期间保持内容可见，不渲染重复状态或全屏重连遮罩。

眼睛控件打开连接详情时，origin 默认模糊、不可选择，并从无障碍 API 隐藏，直到用户激活 `Show`；`Hide` 会恢复遮盖。标签使用句首字母大写形式，Android 外壳继续使用 Web 主题的语义颜色。

`EndpointSelection.isTailscaleEndpoint()` 识别 Tailscale 的 IPv4、IPv6 与 `*.ts.net` 形式。原生桥接检查 Android 的 `NetworkCapabilities.TRANSPORT_VPN`。慢速加载器与无法访问页面利用这些事实区分已关闭的 Tailscale 连接和一般可达性失败，但不把 VPN 状态当作权限依据。

## Testing

连接与布局组件 spec 钉住父页面状态报告、Android 遮罩抑制和普通浏览器遮罩行为。Android 单元 spec 钉住带版本的消息解析器和 Tailscale 地址分类；TypeScript 类型检查与生产 Vite 构建覆盖 App。设备冒烟测试 GUI 报告自身连接状态，断言行内状态，并证明 origin 在 `Show` 前默认被遮盖。Kotlin 编译覆盖原生 VPN 查询。移动端 Chromium 检查验证 18 px 电梯式位移、主题缓动、模糊地址、显示控件与 Tailscale 指引。

## Alternatives considered

**只根据 HTTP 探测推导顶栏。** 否决：文档仍可能正常响应，而两条事件 WebSocket 正在重连；显示状态会与可用 UI 不一致。

**保留 Web GUI 的浮动指示器，并移除 Android 顶栏状态。** 否决：浮动控件会遮挡内容，并重复父页面已经拥有的外壳。

**把任何无法访问的远程地址都推断为 Tailscale。** 否决：LAN 与公网部署需要不同指引。地址分类加 Android VPN 传输可以给出具体提示，而不会声称 VPN 会认证用户。

**打开详情时直接显示端点。** 否决：端点属于诊断信息，可能出现在截图或旁观视线中；显式显示动作既保留可用性，又避免默认暴露。

## Consequences

Android 只有一个稳定连接入口，其状态与嵌入载体一致，恢复期间也不再把控件放在会话内容上方。端点披露多一步点击，Tailscale 失败会给出可执行路径。父页面／iframe 展示协议新增一类带版本消息，原生插件新增只读网络状态方法，而真机行为仍依赖 Android 将 Tailscale 暴露为 `TRANSPORT_VPN`。
