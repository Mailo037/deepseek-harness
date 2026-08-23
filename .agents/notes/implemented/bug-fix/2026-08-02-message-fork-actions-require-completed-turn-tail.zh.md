# Agent Note: 消息 fork 操作要求消息位于已完成轮次尾部

Status: implemented

[English](2026-08-02-message-fork-actions-require-completed-turn-tail.md) | 中文

## 问题

Web 会话从每个轮次中最后一个文本非空的 Assistant 节点派生复制、反馈、时钟与分支操作。已完成的 `turn-tail` 最初保留该 Assistant 的渲染位置，因此稍后的工具结果、被中断的推理（reasoning）节点、重试或终态错误会出现在整行操作下方。Host 会正确地把消息锚点扩展到其所在的 `turn/end`，但这种位置会把操作呈现为一道边界，而同一轮次仍有更多工作位于其后。

## 决策

会话投影只在持久 `turn/end` 到达时发布一个 `turn-tail`。该尾部保留最后一个含内容的 Assistant 作为复制、反馈与分支的目标，但其渲染锚点位于该轮次产生的所有 Assistant、Think、工具、重试与终态行之后。模型输出后接纳的 steering（中途引导）消息仍位于已完成 footer 下方。开放轮次没有操作行，任何后续模型文本或工具调用都不能渲染在操作行下面。

仅当目标 Assistant 同时也是已完成轮次的最后一个 transcript（文本记录）节点时，分支才会启用。稍后的工具结果、只有推理内容的中断、轮次错误或其他 transcript 节点会让分支保持不可用，而复制、反馈与计时仍可在轮次尾部使用。不可用的控件仍然可见、可聚焦、可悬停；`aria-disabled`、tooltip 与 `aria-describedby` 会说明已完成尾部这一要求，且不会发送 Host 请求。Host 按已完成轮次 fork 的语义保持不变。

本资格判定中消息气泡的那一半已被 [user 气泡分支移除决策](../simplification/2026-08-06-user-bubbles-drop-the-branch-action.md)取代：user 与 steering 气泡不再渲染该控件，因此只有含内容的 assistant 尾部可以 fork；assistant 侧门禁及其可见但不可用的呈现保持有效。

本决策收紧了较早的 [Web 会话 fork 操作决策](../feature/2026-07-27-web-session-fork-actions.md)所定义的消息资格。Session 行 fork 仍选择最新的已完成轮次；符合条件的消息操作仍通过共享 client 运行时操作传递其事件 seq。

## 考虑过的替代方案

**在点击的 assistant 消息处截断事件日志。** 不予采纳：assistant 消息可能位于尚未结束的步骤内，也可能包含结果随后才出现的工具调用。以该 seq 截取的原始前缀并不是结构完整的轮次，也可能不是有效的提供方 transcript。

**把操作行直接保留在收尾 Assistant 下面。** 不予采纳：即使稍后的 Think、工具、重试或错误行仍属于同一轮次，该操作行也会在视觉上终止响应。仅禁用分支无法纠正复制与反馈出现在未完成工作上方的问题。

**把 footer 锚定在 `turn/end` 序号之后。** 不予采纳：steering 消息可能在 `turn/end` 之前持久接纳，但在视觉上属于已完成响应之后。footer 跟随模型与工具输出，而不是稍后的用户 steering。

**从 `running` 或下一条用户消息推断完成状态。** 不予采纳：重试轮次与 steering 轮次不一定和下一个可见用户气泡对齐，分页窗口也可能省略该气泡。持久 `turn/end` 事件才是权威的完成事实。

**对每个被中断轮次隐藏分支。** 不予采纳：已中止的轮次会持久关闭，其最终的中断文本可能正是真正的 transcript 尾部。资格取决于已完成边界与节点顺序，而非结果类别。

**隐藏不符合条件的消息控件。** 不予采纳：消失的控件无法说明边界要求，还会让本应稳定的消息 chrome 发生位移。保留可聚焦但不可用的控件，既能维持操作提示，也能阻止请求。

## 后果

启用的分支图标表示的已完成轮次边界与 Host 实际复制的边界一致。在「响应 → 工具 → 被中断的 Think」序列中，所有工作行都会先于复制、反馈、时钟与禁用的分支控件渲染；稍后的 steering 仍位于这些操作之后。本变更刻意不提供同轮次 transcript 编辑，也不提供轮次前重试操作；当读者希望完整复制最新的已完成轮次时，仍可使用 Session 行操作。Conversation Definition 测试固定尾随工具之后、steering 之前的顺序，组件测试则覆盖已完成／开放状态转换与不可用的分支控件。
