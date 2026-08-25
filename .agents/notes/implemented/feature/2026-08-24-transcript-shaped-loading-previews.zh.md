# Agent Note: 基于文本记录结构的加载预览

Status: implemented

[English](2026-08-24-transcript-shaped-loading-previews.md) | 中文

## 问题

打开 Session 时，文本记录回放前只显示三条通用横线。侧边栏基线显示圆形标记、标题横线和元数据横线，像个人资料列表，而非页面即将渲染的 Workspace 与 Session 浏览器。两种加载状态都没有呈现其后内容的信息层级。

## 决策

在 `openState === 'loading'` 期间，ChatView 渲染固定的 assistant／用户／assistant 预览。它复用现有 assistant 正文和用户气泡的几何，但只展示本地加载行。本地化历史加载状态仍是唯一可访问内容；预览不会创建 Conversation Node、消息文本或 Host 请求。

当任一列表基线处于待定状态时，WorkspaceBrowser 渲染两条文件夹行和三条缩进的聊天行。文件夹与聊天图标保留浏览器的 Workspace／Session 区别，只有标题区域脉冲。侧边栏预览对辅助技术隐藏，且不带操作或数据身份。

两个预览都会在减少运动下禁用脉冲动画。

## 考虑过的替代方案

**保留通用横线。** 它们掩盖文本记录中谁在说话，也让侧边栏看起来像无关的个人资料列表。

**显示看似合理的加载文案。** 伪造的消息、Workspace 名称或时间戳在回放较慢时会与真实历史无法区分。

**等数据到达后再显示全部 chrome。** 在同样的等待期间，空白列会失去定位感，却不会提高加载正确性。

## 后果

加载状态携带其后内容的同一视觉层级，而不会新增投影或加载请求。ChatView 与 WorkspaceBrowser 测试固定 assistant／用户和 Workspace／Session 行组合；既有状态和基线行为保持不变。
