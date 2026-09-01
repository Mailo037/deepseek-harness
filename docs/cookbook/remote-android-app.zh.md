# 从 Android 手机设置远程控制

[English](remote-android-app.md) | 中文

本指南说明如何通过 [Harness Remote App](../../apps/android/README.zh.md) 从 Android 手机控制 Harness Web GUI。手机作为运行 `dsh --profile web` 的电脑的远程客户端；App 只是一个轻量 shell（二维码配对、WebView 与通知 service），不会打包 GUI。

准备条件：电脑运行已挂载远程平面的 Harness checkout（自[远程设备平面 Agent Note](../../.agents/notes/implemented/architecture/2026-09-02-remote-device-plane.zh.md)起，它属于 `web` profile）、手机与电脑位于同一网络或隧道内，并已从 [`apps/android`](../../apps/android/README.zh.md) 构建 App APK。

## 1. 启动支持远程配对的 web profile

在电脑上运行：

```sh
dsh --profile web
```

打开 GUI（`http://127.0.0.1:3080`），再进入 **Settings → 远程设备 / Remote devices → 生成配对码 / Generate pairing code**。卡片会显示二维码与过期时间；JSON payload 文本默认隐藏在 Show/Hide 开关后，但隐藏时仍可复制。

要让手机通过 LAN 访问，浏览器 API 的信任围栏必须包含电脑的 LAN 地址，可在启动时传入：

```sh
dsh --profile web --trusted-host 192.168.1.5:3080
```

## 2. 配对手机

在 App 中选择 **Scan QR Code**。App 会按二维码 payload 中的顺序尝试端点（先是自动探测到的 LAN 地址，再是额外配置项），通过设备 channel（`ws://<pc>/remote/device`）执行 `pair` 握手，保存设备 secret，然后在全屏 iframe 中打开 GUI。

手动回退：在 App 的手动字段中输入服务器 URL（`192.168.1.5:3080`）和配对 token。

## 3. 后续行为

- **前台通知 service** 使用已保存的 secret 连接设备 channel。Host 推送 `turn-error` 或 `turn-completed` frame 时，它会发布 Android 通知。Service 使用退避重连，并在 App 进入后台后继续工作。
- **GUI iframe** 每次连接都从电脑重新加载当前 Web GUI，因此电脑上的 GUI 改进不需要更新 App。
- 电脑不可达时，App 显示带重试按钮的连接丢失页面；手机断网时则显示离线横幅。

## 4. 撤销设备

在电脑上进入 **Settings → Remote devices → 断开连接 / Disconnect**，选择对应手机。Host 会立即终止 socket、删除设备记录并使 secret 失效；手机必须重新扫描配对码后才能再次连接。

## 通过 Tailscale 远程访问

以上步骤只能从家庭 Wi-Fi 访问电脑。在两个设备上安装 [Tailscale](https://tailscale.com) 后，手机可通过加密 tailnet 从移动数据或任意网络访问 GUI 与通知 channel，无需路由器端口转发，切换网络时也无需重新配对，因为 App 会保存所有端点并自动回退。

**在 tailnet 上使用 HTTP，而不是 `tailscale serve`。** 所有端点都使用明文 `http://`（Tailscale IP 或 MagicDNS 名称），channel 使用 `ws://`。`tailscale serve` 是到 `127.0.0.1` 的反向代理，会让 Harness 把访问视为 loopback 并静默绕过 GUI access-token guard。直接经 tailnet 使用 HTTP 会保留该 guard：Tailscale 地址（`100.x.y.z`）不是 loopback，因此 `isLoopbackRequest` 仍要求 access token。

### 设置

1. 在电脑安装并登录 Tailscale；在 Android 设备安装 Tailscale，并登录同一 tailnet。
2. **引导路径：** 在 GUI 中打开 Settings → Remote devices → **Set up with Tailscale**。设置区会把任务排入当前会话，由 agent 运行 [dsh-tailscale-remote-setup skill](../../.agents/skills/dsh-tailscale-remote-setup/SKILL.md)：检查电脑的 Tailscale 状态，把下方条目合并进用户 profile patch，验证组合与可达性，再引导配对和手机步骤。
3. **手动路径：** 先读取 `$DSH_HOME/profiles/web/cordis.patch.yml`，仅替换或插入以下三个归属条目并保留其他内容。每个条目必须重述完整 `config`，因为 patch 不做深合并；`<TAILSCALE_HOST>` 取自 `tailscale ip -4`：

   ```yaml
   - id: webserver
     config:
       host: '0.0.0.0'
       port: !!js ctx.webStartup.port ?? 3080

   - id: web-runtime
     config:
       openBrowser: !!js ctx.webStartup.openBrowser
       printUrl: true
       surfaceContext: true
       trustedHosts: !!js >-
         [...ctx.webStartup.trustedHosts, '<TAILSCALE_HOST>']

   - id: remote
     config:
       endpoints: !!js >-
         ['http://<TAILSCALE_HOST>:' + (ctx.webStartup.port ?? 3080)]
       pairingTtlSeconds: 300
       notifyOnError: true
       notifyOnCompleted: true
       printPairingQr: !!js ctx.webStartup.printPairingQr ?? false
   ```

   Profile patch 是用户自有层，在 checkout 与构建安装中都会应用于所有 bundle layer 之后。运行中的服务器通过 patch watcher 实时读取变更，无需重启。用 `dsh --profile web --dump-config` 验证组合；在 checkout 中通过 `pnpm dsh` 运行。随后通过 tailnet 地址请求 `http://<TAILSCALE_HOST>:<HARNESS_PORT>/`；200 或 4xx 都能证明路径可达，access-token guard 仍然生效。
4. 今后直接运行 `dsh --profile web`，不要带 `--host`/`--trusted-host`。Launcher flag layer 位于用户 patch 之上，这些参数会覆盖 patch 中的绑定与信任围栏；`--no-open` 和 `--pairing-qr` 不受影响。
5. 重新生成配对码（Settings → Remote devices → Generate pairing code）并在 App 中扫描。App 会保存完整端点列表，可从两个网络访问。
6. 测试 Wi-Fi、移动数据、两者切换、飞行模式开关以及锁屏数分钟。WebSocket 与 GUI 应自动恢复，无需重新配对。

### ACL / grant 规则（Tailscale 管理控制台 → Access Controls）

```json
{
  "grants": [
    {
      "src": ["<TAILSCALE_ACCOUNT>"],
      "dst": ["tag:harness-pc"],
      "ip": ["tcp:<HARNESS_PORT>"]
    }
  ],
  "tagOwners": { "tag:harness-pc": ["<TAILSCALE_ACCOUNT>"] }
}
```

为电脑设置一次标签（`tailscale set --tag=tag:harness-pc`）。该规则只允许你自己的账户访问已标记电脑上的 Harness 端口。

### 电池优化

为 **Tailscale** 关闭电池优化（“Unrestricted”），并为 Harness Remote App 选择“Never sleep”或“Always allow”。否则 Doze 与深度睡眠可能让 tailnet 连接和设备 WebSocket 中断数分钟。App 不会自行更改系统设置。

### 安全模型

这里有两个独立层次：tailnet 网络访问（以上 ACL）与 Harness access token。Tailscale 连接仍强制要求 token；只有你自己的设备可以访问已标记电脑上的 Harness 端口。
