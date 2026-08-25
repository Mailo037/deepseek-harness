# Agent Note: 排队图片缩略图

Status: implemented

[English](2026-08-24-queued-image-thumbnails.md) | 中文

## 问题

QueueDock 会把图片块扁平化为字面标记 `[image]`，尽管排队消息已经携带了预览所需的附件引用。

## 决定

QueueDock 保留 QueueMirror 预览的文本预算，并在每个图片块原有的内容位置渲染 24px 缩略图。它通过 `ConversationController.resolveImage` 解析 `ImageAttachmentRef`；附件加载中或加载失败时，会显示现有的中性图片图标而非标记文本。纯文本和其他非图片预览保持原有渲染。

## 考虑过的替代方案

**始终保留通用图片图标。** 通用图标可以表示媒体种类，却不能给出排队图片的可用视觉提示。

**嵌入提交时的 Base64 数据。** Queue 行使用 host 拥有的附件引用；其加载器将图片访问限制在已渲染会话内，并复用现有 URL 缓存。

**新增更丰富的队列 wire 预览。** 当前 Queue 内容已经记录块顺序和附件身份，因此 dock 可以在不扩展 runtime 投影的前提下完成这一展示变更。

## 后果

带图片的 Queue 行会异步加载缩略图，而不改变其 Queue 操作、编辑规则或权威顺序。`queue-dock.client.spec.tsx` 验证解析出的缩略图会替代标记文本，混合内容测试仍固定非文本的编辑限制。
