# Agent Note: 浏览器安全的 RPC 关联 ID

Status: implemented

[English](2026-08-30-browser-safe-rpc-ids.md) | 中文

## 问题

浏览器 API 载体使用 `crypto.randomUUID()` 签发 rpcId。浏览器只在安全上下文中提供该方法，而受支持的远程 GUI 可以在受信任的局域网或 Tailscale 地址上使用普通 HTTP。同步的 ID 签发失败会在事件套接字已构造、但握手尚未到达宿主时中止新的连接代际，使 GUI 停留在重连状态，而独立的原生设备通道仍会传送通知。

## 决策

API 载体拥有一个由 `crypto.getRandomValues()` 提供随机性的 RFC 4122 版本 4 生成器，浏览器在非安全来源中也提供该 API。`AbstractApiClient`、通用连接 RPC 调用方和客户端 fixture 共用该生成器。没有 Web Crypto 的运行时会在发送前失败；载体不会回退到 `Math.random()` 或其他更弱的来源。

远程浏览器 e2e 将一个非回环 `.test` 主机名解析到回环测试服务器，并断言其页面不是安全上下文。因此，普通连接和重新加载路径会覆盖暴露该缺陷的浏览器环境。包级覆盖还会从测试 crypto 对象中移除 `randomUUID`，并通过 fetch 处理器传载一次真实的 `host.describe` 请求。

## 考虑过的替代方案

**要求每个远程 GUI 使用 HTTPS。** 否决：受信任的局域网和 Tailscale HTTP 访问已是受支持的部署方式，且请求关联不需要仅安全上下文可用的 API。

**使用递增或伪随机标识符。** 否决：rpcId 会跨越并发流和诊断观察点；Web Crypto 可以提供足够的随机性，无需降低现有的唯一性预期。

**在重连控制器中捕获 ID 签发失败。** 否决：重试不会让 `randomUUID()` 出现在同一来源上。载体必须使用每个受支持的浏览器上下文都可用的 API。

## 后果

普通 HTTP 远程浏览器可以完成就绪 RPC 并保持两个事件流。安全上下文、Electron 和进程内调用方使用相同的 UUID 格式。此更改没有 transcript 或模型可见输出，因此不更改快照；组装后的浏览器 e2e 负责覆盖用户可见的重连回归。
