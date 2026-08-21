# Agent Note: Composer-side queue editing and drag reorder

Status: implemented

[English](2026-08-21-composer-side-queue-edit-and-reorder.md) | 中文

## Problem

Queue dock 在拥挤的单行内联输入框中编辑待处理行，并且无法改变排队消息的发送顺序。内联编辑器在一个贫化的第二表面上重复实现了 composer 的关注点（IME 组合守卫、撤销历史），而且编辑一行会丢掉用户正在 composer 中起草的内容。

## Decision

重排与编辑是同一条权威队列快照之上的两个新动词：

- **Wire**：`QueueAction` 新增 `{ kind: 'move'; toIndex: number }`。Host 处理器只接受针对 `next-turn` 行的 move（steering/context 行返回 `queue-item-not-found`），并把 `toIndex` 收敛进当前列表，因此快照与落点之间的认领竞态会退化为最近位置的提交而不是报错。
- **Inbox**：`Inbox.move(messageId, toIndex)` 以恰好一次持久窗口 splice 重新定位一条待处理的 next-turn 消息，窗口覆盖 `[min(from,to), max(from,to)]` 并在内部重排。该变更是静默的——没有 `outcome: 'canceled'`，不发出 discarded/inserted 通知——因为没有任何消息进出队列。标识保持不变；回放通过既有的通用 splice 应用重建。
- **Dock**：一旦存在两条普通会话行，每行最左侧出现拖拽手柄。把它拖到另一行上（HTML5 dnd），或在聚焦的手柄上按 ArrowUp/ArrowDown，都会提交一次 `move`；落点指示只是呈现，顺序由权威快照重绘。客户端依然不做乐观变更。
- **Composer 编辑**：dock 的编辑动词把该行交给每会话的 input shell。shell 暂存当前草稿与已附加的图片 id（描述符保持存活），把草稿替换为该行文本，并发布 `InputState.queueEdit`。编辑载入期间的提交完全绕过 slash adjudication，针对该入队项发送一次文本 `edit` 操作——其队列位置保持不变——随后恢复暂存。Escape、横幅按钮和 dock 的逐行取消都会在不改动队列的情况下恢复。仅含空白的提交与机器的空草稿守卫一样是无操作。若被编辑的入队项在编辑期间离开待处理队列，暂存会自动恢复，竞态无法吞掉用户自己的草稿；在该行仍待处理时，被拒绝的编辑保持打开并显示本地化提示。编辑载入期间，整队列加速 Enter steering 手势会被抑制。

## Alternatives considered

- **客户端乐观重排** — 拒绝：这会破坏队列投影已确定的规则（下一份 Host 快照是唯一可见提交），而被拒绝的 move 还需要回滚逻辑，权威路径本来就免费提供正确性。
- **以 remove+insert 两次 splice 实现 move** — 拒绝：一次就够的事变成两个持久事件，删除会携带取消结果并触发 discarded 通知，事件之间的窗口把一次实时重排误表示为取消。
- **保留内联编辑器并在旁边加重排手柄** — 拒绝：内联输入以极低的品质重新实现 composer 的一部分（IME 守卫、撤销、光标处理），而产品方向本来就是在 composer 中编辑。
- **只为被移动的消息发出 `agent/inbox/inserted`** — 拒绝：goal-round-driver 等消费方把插入的 next-turn 消息读作新出现的竞争排队工作；纯重排不能看起来像新的竞争，静默模式才是诚实的信号。

## Consequences

任意距离的重排都只花费一个持久事件，同步观察方看到的是一次原子的位置变化。编辑暂存只存在于会话 input shell 内且从不发布，因此它能跨会话切换存活（每个 shell 拥有自己的暂存），但不能跨页面刷新——与未提交草稿一贯的持久性相同。queue-actions 浏览器场景现在演练 composer 侧编辑与拖拽重排；它的 `editing` 与 `preserved` aria golden 描述了新表面，并随该次运行一起刷新。
