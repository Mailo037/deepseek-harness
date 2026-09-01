# Agent Note：远程设备平面的 Tailscale 端点

Status: implemented

[English](2026-08-28-tailscale-remote-device.md) | 中文

## 问题

Android 远程 App 只存储一个服务器 origin。手机在家庭 Wi-Fi 和移动数据之间切换时，Wi-Fi 路径一断，GUI iframe 和设备 WebSocket 都会失联。即使 host 已在二维码 payload 中发布多个端点，App 也无法改走 tailnet 访问电脑。

## 决策

**使用一个纯选择模块持久化多个端点。** App 保存二维码中的完整规范化端点列表，并丢弃 loopback 别名，因为它们在手机上只会指向手机自身；同时保存最近成功的 origin。`EndpointSelection.ts` 通过纯函数 `endpointsOf` 和 `selectCandidates` 统一选择逻辑。GUI 探测与 `NotificationService` 都从这里取得候选顺序，Kotlin service 接收已排序的 `wsUrls`，因此选择规则只有一个实现。优先级为：最近成功 → 存储顺序（LAN → Tailscale → 其他）。GUI 探测成功或 channel 收到 `authed` 后都会写回获胜 origin，使两个平面收敛到同一端点。

**在 tailnet 上使用 HTTP，而不是 `tailscale serve`。** `tailscale serve` 代理到 `127.0.0.1`，Harness 会把所有访问视为 loopback，`isLoopbackRequest` 因而绕过 GUI access-token 防护，使 tailnet 成员资格与 GUI 鉴权之间的纵深防御退化为单层。通过加密 tailnet 直接使用 `http://`/`ws://`，可让 `100.x.y.z` 保持非 loopback，防护仍然生效。无需 TLS、证书或 MagicDNS；LAN 本来就需要 `usesCleartextTraffic`。

**前台 service 类型使用 `specialUse`。** 在 `targetSdk = 36` 下，`dataSync` 有 6 小时超时且不能从 `BOOT_COMPLETED` 启动，`specialUse` 没有这两项限制。Manifest 通过 `PROPERTY_SPECIAL_USE_FGS_SUBTYPE` 声明用途，`BootReceiver` 在重启后恢复 channel，`onTimeout` 则防御未来平台行为变化。Android 14 以下继续使用双参数 `startForeground`。

**确定性重连。** Kotlin service 保留 OkHttp 的 `WebSocketListener` 形式，但每次连接按候选端点逐个尝试：每端点 10 秒连接窗口，第一个 `authed` 获胜；`rejected` 会关闭重连，因为无效或已撤销的 secret 无法靠重试恢复；整轮失败后进入指数退避，基准 1 秒、上限 60 秒、0–50% 抖动，成功后重置。`registerDefaultNetworkCallback` 与 `ACTION_DEVICE_IDLE_MODE_CHANGED` 会取消待执行退避并立即重连，因此 Wi-Fi 与移动数据切换或退出 Doze 后无需等待定时器。

## 对设计草案的一项有意偏离

`BootReceiver` 草案使用 `SharedPreferences.getStringSet` 读取持久化候选，但 `Set` 会破坏候选顺序，而最近成功优先正依赖该顺序。Channel 参数改为在相同 key（`last_ws_urls`、`last_secret`、`last_device_id`）下保存 JSON 数组字符串；`loadChannelParams` 是 `BootReceiver` 与 sticky restart 共用的唯一读取器。

## 测试

`apps/android/tests/` 新增无需模拟器的 vitest 单元测试：端点规范化、loopback 过滤、去重、候选排序，以及旧单 URL 配置迁移到 `endpoints` 与最近成功值，同时保留身份字段并验证 `persistLastSuccessful` 的追加语义。`tests/device/` 下的模拟器测试通道未变。Wi-Fi 与移动数据切换、Doze、开机等网络迁移仍属于真机手工矩阵；决定这些迁移的选择逻辑已由单元测试覆盖。

## 曾考虑的替代方案

### 通过 `tailscale serve` 访问 tailnet

否决。它代理到 `127.0.0.1`，会让 Harness 把所有访问视为 loopback 并绕过 GUI access-token 防护。直接经加密 tailnet 使用 HTTP/WS 可保留非 loopback 地址和双层防护。

### `dataSync` 前台 service

否决。它在 `targetSdk = 36` 下有 6 小时超时且不能从 `BOOT_COMPLETED` 启动。`specialUse` 支持开机启动并维持长期远程通道。

### 使用 `SharedPreferences.getStringSet` 保存候选

否决。`Set` 会破坏最近成功优先所需的顺序。JSON 数组字符串保留顺序，并让开机与 sticky restart 共用一个读取器。

## 后果

App 现在会收敛到一份有序端点列表，Wi-Fi 与移动数据切换或退出 Doze 后无需重启 channel，也不会丢失 GUI 连接。接受的代价是：tailnet 上的明文 HTTP/WS 不再叠加 TLS 或证书，而是依赖加密隧道；网络迁移仍是真机手工矩阵，而不是自动化测试。
