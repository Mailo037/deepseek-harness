# Agent Note：Think-only 步骤始终并入工具角色分组

Status: implemented

[English](2026-08-24-thinking-seats-join-tool-group.md) | 中文

## 问题

会话流把连续的 tool 调用渲染进一个有边界的 `ToolCallGroup` 窗口（工具角色座位）内，而携带可见文本的步骤以普通流渲染并切分 run。Think-only 步骤——即唯一渲染内容是 reasoning 行加工具头、没有任何可见文本的 assistant 步骤——过去因位置不同而采用不同处理。只有在后续仍不断有 tool 调用时，它才加入其所在的 run；末尾的 Think-only 步骤（在下一段可见内容之前没有更多 tool 调用）会被冲刷进普通流。这样同一个 reasoning 座位会因为在后面是否恰好出现某个 tool 调用，而被渲染进窗口内或窗口外——于是以思考收尾的 run 会把 Think 行遗留在答案文本上方的流里，而不是收进它所属的工具窗口。工具角色的组合因此自相矛盾：Think 行属于工具角色表面，并不属于答案文本。

## 决策

在 `ChatView.buildElements` 中，Think-only 步骤现在与 `tool-call`、`model-retry` 或 `context` 节点是同类 run 成员：它无条件加入（或开启）run，只有当出现非成员节点或流结束时才冲刷 run。`trailingThink` 缓冲区及其两个刷洗器（`flushThinkIntoRun`、`flushTrailingThinkStandalone`）已被移除；循环在非 run 路径上只调用一次 `flushRun`，并在结尾再调用一次。`groupHeaderOf` 本就会把纯 Think 行的 run 命名为 “Think”，因此无需改动头部。`runIsActive` 现在对状态为 `running` 的成员 assistant 步骤也返回 true，这样流式末尾的 Think 行在仍在更新时会让窗口保持打开状态，而不是藏到收拢的分组头部之后。中断步骤仍以普通流渲染，因为 `isThinkOnly` 对它们仍返回 false；其 Stopped 标记绝不能藏在工作汇总折叠之后。

## 曾考虑的替代方案

**保留末尾 think 在流中，只对分组切分做描述性修正。** 这正是此前的行为，也就是被报告的缺陷：座位的位置取决于之后是否恰好存在 tool 调用，而不是取决于 reasoning 属于哪块表面。

**把末尾 Think 行当作答案文本开头的引导。** 否决：它唯一的可见内容是一个没有可见文字的 reasoning disclosure，与紧随其后的文本步骤毫无共同点，应当属于工具角色表面。

**让 `runIsActive` 只检查 tool 调用。** 否决：收拢分组里的流式末尾 Think 行会在它仍在动画时缩成头部，正好把打开时保持激活行为本要展示的活动藏了起来。

## 后果

工具角色窗口现在自洽：无论之后是否还有 tool 调用，每个 Think-only 座位都渲染在分组内。单独的 Think-only 步骤仍按单成员规则渲染成无窗口铬条的裸行；被中断的 think 仍切分 run，并保留其可见的 Stopped 标记。流式末尾的 Think 现在会在更新期间让分组保持打开。`chat-view.client.spec.tsx` 中固定旧尾端入流行为的测试已更新为断言 Think 行在分组内；中断入流与混合 reasoning+text 入流的保证保持不变。
