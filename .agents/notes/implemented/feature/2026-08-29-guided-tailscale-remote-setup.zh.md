# Agent Note: 从远程设备页面发起的引导式 Tailscale 设置

Status: implemented

[English](2026-08-29-guided-tailscale-remote-setup.md) | 中文

## Problem

按照 cookbook，通过 Tailscale 的手机远程访问需要手工编辑配置文件：这里一行绑定、那里一个信任围栏条目、再加 remote 插件的一个端点。人们实际运行的配置并不完整——只有裸的 `0.0.0.0` 绑定，缺围栏条目和配对端点——而且脆弱：取值要么活在启动 flags 里，要么活在被 track 的仓库文件里。没有亲手写过这套流程的用户没有任何路径能得到完整、持久的配置。

## Decision

**远程设备设置页把设置工作交给会话中的 agent。** `ui-remote` 设置区新增一个 Tailscale 分组，其动作通过 sessions face（`binding(current).session.prompt(..., 'queue')`）把本地化的设置任务排入当前会话，然后关闭设置模态框、落到始终挂载的会话视图上（`settings.section` 的 owner `close` prop）；没有可用的普通会话时拒绝执行（当前没有会话，或当前路由是 subagent 目录）。Prompt 指名 [dsh-tailscale-remote-setup 技能](../../../skills/dsh-tailscale-remote-setup/SKILL.md)及其固定点：tailnet 上的明文 `http`，绝不用 `tailscale serve`。

**该流程写入用户的 profile 补丁，而不是仓库文件。** 技能把三行合并进 `$DSH_HOME/profiles/web/cordis.patch.yml` ——`webserver` 绑定行、`web-runtime` 信任围栏行、`remote` 端点行——并原样保留用户的其余行与注释；每个被接管的行都要重述完整的 `config`，因为 patch 从不做深合并。运行中的服务器通过补丁监视器（`watchUserPatches`）实时重新组合用户补丁层，设置因此无需重启；`dsh --profile web --dump-config` 离线验证组合，一次经 tailnet 地址的请求验证可达性。主机重启仅作为错过实时重载时的回退。

**启动 flags 让位于补丁。** Launcher flag 层位于用户补丁之上，因此流程固定使用朴素的 `dsh --profile web` 启动：`--host`/`--trusted-host` 会覆盖补丁行；`--no-open`/`--pairing-qr` 保持无害。

## Alternatives considered

- **由 host Remote 方法程序化地执行设置。** 落败：该流程是跨环境事实（Tailscale 状态、实际端口、既有补丁内容）的诊断加合并加验证，agent 的工具已经胜任；wire 方法会复制文件系统与策略语义，并为一次性设置扩展 device wire 契约。
- **继续以 checkout 的 bundle 补丁（`packages/bundle/web-app/cordis.patch.yml`）为写入目标。** 落败：仅限 checkout 且被 track——设置会弄脏工作树并死于 pull；profile 补丁才是面向 checkout 与构建安装的用户自有层。
- **在设置侧做一个自己执行步骤的向导。** 落败：登录、ACL 与配对需要用户交互或浏览器客户端无法触及的 host 工具；agent 会话已经把确认、提问与进度集中呈现在一处。

## Consequences

买到：任何用户一键获得完整、持久的设置；无需重启的实时重配置；信任围栏保持显式——Tailscale 地址是新增的受信任 authority，而不是被削弱的防护。付出：交接需要当前存在普通会话，且无法确认完成——回退到重启后，只有用户返回会话才会继续；agent 在用户文件里编辑 YAML，dump 验证步骤就是防错误合并的保障。技能与[ Cookbook](../../../../docs/cookbook/remote-android-app.zh.md#remote-access-with-tailscale)共享 profile 补丁流程，必须一起变动。

## Related

- [远程设备平面的 Tailscale 端点](../architecture/2026-08-28-tailscale-remote-device.zh.md)——本设置所喂养的多端点 App 行为。
- [远程设备平面](../architecture/2026-09-02-remote-device-plane.zh.md)——本设置所配置的 host 平面。

## Testing

组件 spec 覆盖交接的各结果（成功关闭设置；无会话、拒绝与抛错停留并显示提示；in-flight 状态），以及设置区的配对、设备与令牌状态；注册 spec 钉住 inject 列表，以及排入的 prompt 指名该技能。`DSH_SNAPSHOT=replay pnpm run test:web` 回放组装后的 GUI。完整流程在编写者机器上端到端跑通：补丁合并、离线 dump、无重启的实时重载、tailnet 可达性，以及以 Tailscale origin 打头的配对 payload。
