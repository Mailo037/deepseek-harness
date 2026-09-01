# Agent Note: Remote devices 配对载荷与访问令牌默认掩码，需显式展示

Status: implemented

[English](2026-08-26-remote-settings-secret-reveal.md) | 中文

## 问题

远程设备设置区此前以明文渲染两个机密：配对二维码的载荷（`pairingCreate` 返回原始 JSON 字符串，内嵌一次性配对令牌和持久的 GUI 访问令牌），以及设备列表下方的访问令牌分组。卡片一经打开，旁观者或屏幕共享中的任何人都能看到完整内容；即便后续调整样式，悬停用的 `title` 属性也始终携带完整字符串。产品需求（2026-08-26）是两者都必须经过显式展示动作才能查看。

## 决策

两处载荷文本在各自的「显示」按钮翻转组件内标志之前，一律渲染固定占位符 `SECRET_MASK = '•'.repeat(16)`。固定宽度使占位符无法泄露令牌或载荷的真实长度；`title` 属性仅在已展开时携带明文，堵住了提示浮层的泄露路径。每个显示按钮都会切换成对应的隐藏按钮（`settings.remote` 命名空间下的 `pairingReveal`/`pairingHide` 与 `accessTokenReveal`/`accessTokenHide`）。复制按钮在掩码状态下仍然可用——不看也能复制。重新生成配对码会把其载荷重置为掩码；访问令牌在每次进入该页时于挂载时读取一次，同样从掩码开始。

## 已否决的替代方案

**超时后自动隐藏。** 否决：未等观看者做出任何动作就再次出现明文窗口，且时长属于本仓库禁止的硬编码可调参数。

**掩码期间禁用复制。** 否决：屏幕共享中用剪贴板恰恰是安全场景，砍掉它是纯损失。

**改用密码输入框承载。** 否决：这些值是只读参考数据而非表单字段；沿用文本节点加按钮，才能让本区的令牌样式表保持唯一权威。

## 后果

- 截图与屏幕共享默认安全，除非有人主动展开。
- 展开状态保存在 `useState` 中：切到其他设置页再回来会重置，不做持久化。
- 中英词典各新增四个键；`satisfies Record<RemoteLocaleKey, string>` 的镜像约束在编译期把 zh/en 锁在一起。

## 测试

`packages/client/ui-remote/tests/components.client.spec.tsx` 在 jsdom 下驱动两条链路：载荷默认掩码、经 `pairingReveal` 显示、经 `pairingHide` 复位为掩码；访问令牌通过自己的键走同样的门（含复位状态）；新生成的配对码从不以明文渲染。套件（3 个文件、15 个测试）与 `tsc -b packages/client/ui-remote/tsconfig.json` 在变更后均为绿色。
