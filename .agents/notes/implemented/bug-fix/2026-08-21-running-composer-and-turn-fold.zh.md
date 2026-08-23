# Agent Note: Running-session composer primary and duplicate turn fold

Status: implemented

[English](2026-08-21-running-composer-and-turn-fold.md) | 中文

## Problem

来自真实使用的两个组装后聊天缺陷。其一，当一个已关闭 Turn 的节点列表被一条 Session 作用域的行分割时——典型是中途被接纳的 steer——会渲染出两个完全相同的「Ran for …」时长折叠（连 React key 都重复），一个在回答控件上方、一个在下方。其二，Session 运行期间编辑器的主按钮被硬绑为 Stop，纯指针路径无法把已输入的后续消息排入队列；只有 Enter 手势能到达队列。

## Decision

- **每个 Turn 只有一个折叠**（`ui-conversation` ChatView）：Flow 构建先按连续相同的已关闭 Turn 对节点顺序分段，折叠判定读取整个 Turn——≥10 个动作的阈值对该 Turn 的所有段落求和，全部可折叠元素按 Turn 收进一个 body，位于该 Turn 首个折叠处的占位 slot 在遍历结束后解析为唯一的摘要。
- **非空草稿优先于 Stop**（`ui-conversation` InputBar）：普通 Session 运行期间，草稿有内容时主按钮切回 Send；点击经由与运行态 Enter 手势相同的 queue-mode 提交解析（入队，或在 busy 偏好如此时转为插话）。草稿为空时主按钮保持 Stop。载入待编辑的排队消息仍显示 Save，continuable 子会话保持 Send 主按钮加独立 Stop。

## Alternatives considered

- **在分块器中跨越间隙合并**（把两个相同关闭 Turn 之间的无 Turn 节点视为 Turn 的一部分）：落选，因为被插入的行必须留在流中自己的位置上，放宽分块器还会把真正 Session 作用域的行吸进折叠体。
- **保留 Stop 并额外显示第二个 Send 按钮**：落选，因为两个相邻主按钮争夺同一手势槽位；草稿有内容本身就是明确的意图信号。

## Consequences

Turn 摘要的 React key 重归唯一，被分割 Turn 的折叠工作无论 steering 行位于何处都渲染在其唯一 disclosure 内。运行期间要停止需要清空草稿（清空，或完成一次排队编辑）——可接受，因为输入本身就是意图信号，空草稿状态会立即恢复 Stop。提交面不支持队列的组合保持原形态：没有运行中的 Turn 时一切不变。

## Testing

`packages/client/ui-conversation/tests/chat-view.client.spec.tsx` 固定 steer 分割的折叠 Turn 只渲染一个时长摘要；`packages/client/ui-conversation/tests/input-bar.client.spec.tsx` 固定非空草稿的 Send 切换、点击触发的队列分发，以及空草稿下 Stop 的保留。
