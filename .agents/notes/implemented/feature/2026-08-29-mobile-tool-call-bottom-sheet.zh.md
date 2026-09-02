# Agent Note: 移动端界面使用共享底部弹层

Status: implemented

[English](2026-08-29-mobile-tool-call-bottom-sheet.md) | 中文

## Problem

手机视口中的三个对话界面过于拥挤或突兀。可展开的工具调用行在消息流内展开，使很长的 IN/OUT 卡片、终端、diff、读取、搜索或 Web 内容挤进窄列并撑大消息流。会话标题的后台任务列表和 subagent 目录使用标题锚定浮层，可能溢出窄视口或依赖悬停（subagent 目录通过悬停打开，触屏无法点击打开）。这些浮层还会瞬间出现、消失，没有关闭动画。弹层内容必须保持实时：工具调用仍在流式输出时，点击后必须看到最新内容，而非点击时捕获的快照。

## Decision

`@deepseek-ai/dsh-client-ui-primitives` 提供受控 `BottomSheet` 原子组件（`BottomSheet.tsx` 和 `BottomSheet.module.css`）。这是可复用的手机界面：全宽、底部锚定的卡片通过 portal 渲染到 `document.body`，避免被滚动容器或带 transform 的祖先限制；默认占半个视口，打开时上滑，可在默认高度与接近全屏的高度间拖拽，也可下拉越过阈值关闭。它拥有可点击关闭的遮罩、带关闭按钮的标题栏、拖动手柄、`--sheet-h` 高度属性、`Escape` 关闭、可见时的页面滚动锁定以及对话框初始聚焦。调用方传入 `open`、`onClose`、`title`、`closeLabel` 和实时 children。

关闭具有动画：`open` 变为 false 后，弹层在下滑和遮罩淡出期间保持挂载，之后才卸载。因此调用方在可能展示弹层时保持组件挂载，无条件渲染 `<BottomSheet open={...}>`，不以 `open` 控制挂载，只通过该属性控制可见性。

六个界面使用它，均以 composer 和模型选择器相同的 `matchMedia('(max-width: 639px)')` 断点启用：

- `ToolRow`（`ui-tool`）在手机上不内联展开；其 `open` 保持 false，行保持单行，点击后在弹层展示相同的展开内容。两个界面复用同一个元素，并随行的实时 props 重渲染，因此流式内容在打开的弹层中持续更新。作为随产品发布的 bash 渲染器，`BashRow` 具有相同行为。
- `JobListAction`（`ui-jobs`）在弹层中渲染任务行，而非标题锚定浮层。手机上禁用外部指针关闭监听器，由弹层遮罩负责关闭；任务终止和日志交互不变。
- `SubagentHeaderLineage.CatalogDropdown`（`ui-subagent`）在弹层中渲染目录树。手机没有悬停，触发器也成为点击目标；手机上禁用悬停开关定时器以及外部指针和定位监听器。
- `LineChangeSummary`（`ui-deliverables`）在弹层中渲染“N 个文件已更改”的逐文件明细，代替 composer 锚定浮层，并在手机上禁用外部指针监听器。
- `ReasoningRow`（`ui-conversation`）在手机上不内联展开思考文本；行保持单行，点击后在弹层展示推理文本，并随流式文本更新。
- `ToolCallGroup`（`ui-conversation`）在手机上将连续工具/思考窗口作为弹层打开，而非内联展开。弹层内部每行保留自己的手机弹层，因此点击某行会在窗口上方打开该调用的内容弹层。

`conversation`、`subagent` 和 `deliverables` locale namespace 各自增加 `sheet.close` 键（`关闭` / `Close`），作为关闭按钮标签。

`ModelSelect` 模型选择器（`ui-model-selection`）也使用共享组件，其两级面板拥有相同的外观、拖拽/吸附与关闭动画。原本自行维护的 `--sheet-h` 拖动、手柄、标题以及专有拖拽常量和处理器已移除。

## Alternatives considered

**手机上保留内联展开和标题浮层。** 工具内容虽然可在卡片内滚动，长内容仍占据狭窄对话列并推开周围消息；标题浮层会溢出，subagent 目录的悬停打开无法通过触屏操作。

**把模型选择器的弹层代码复制给每个消费方。** 每个消费方将维护重复的拖拽、手柄和遮罩逻辑。`ui-primitives` 中的共享组件让移动端界面逻辑归于一处，模型选择器也能采用它。

**打开时把内容捕获到 state。** 用户打开弹层时工具调用可能仍在流式输出，冻结的快照会过时。通过行的 props 渲染同一个实时元素，无需额外订阅或第二份数据源。

**关闭时立即卸载。** 这会瞬间移除界面，缺少关闭反馈。过渡期间保持挂载是标准受控对话框模式，只要求调用方不以 `open` 控制挂载。

**通过现有 Details 面板打开工具行。** 该面板是由全局选择确定的独立全高区域，不是行自身的内容，也不符合“展示这一行内容”的操作含义。

## Consequences

手机上可展开工具调用保持单行，内容在可拖拽、全宽、aria-modal 的底部弹层中打开；同一个组件还承载思考文本、连续工具调用窗口、后台任务列表、subagent 目录树和 composer 的逐文件变更明细。背景页面滚动被锁定；关闭时弹层下滑、遮罩淡出后再卸载。桌面行为不变：工具行、思考和连续调用窗口仍内联展开，任务、subagent 和变更明细仍使用浮层。共享 `BottomSheet` 可供后续手机界面使用；工具和推理内容不因展示位置不同而拥有多个来源。流式调用增长时弹层不会自动滚动到最新输出，读者需滚动或展开弹层；自动滚动留待后续实现。

## Testing

`BottomSheet` 组件测试覆盖关闭按钮、遮罩点击和 `Escape`；关闭过渡期间保持挂载再卸载；页面滚动锁定与恢复；实时子元素重渲染；默认高度吸附；越过阈值拖拽关闭。`ToolRow`、`BashRow`、`JobListAction`、`SubagentHeaderLineage.CatalogDropdown`、`LineChangeSummary`、`ReasoningRow` 和 `ToolCallGroup` 测试验证手机视口使用包含相应内容的底部对话框，而非内联或浮层，并验证关闭按钮触发下滑后卸载。Web snapshot 回放（`DSH_SNAPSHOT=replay pnpm run test:web`）覆盖变更后对话 UI 的组装浏览器输出。
