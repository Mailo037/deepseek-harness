# Agent Note: 移动端弹出层保持在视口内

Status: implemented

[English](2026-08-21-popup-viewport-clamping.md) | 中文

## Problem

创作器的模型选择器菜单只用纯 CSS 定位（`position: absolute; right: 0; bottom: calc(100% + 8px)`），因此它的位置完全取决于触发器所在的位置。在手机视口上——创作器及其控件紧贴屏幕边缘——320px 宽的菜单可能从左右两侧溢出屏幕，靠近屏幕顶部的长菜单也可能从顶部溢出。其他弹出层已经在 JavaScript 中自行钳制到视口（`Menu` 的 portal 模式、经由该 portal 的 `Select`/`MultiSelect`、`Tooltip`、`HoverCard`），因此模型选择器是剩余的问题点；但原语 `Menu` 默认的非 portal 列表也没有对视口的宽度限制。

## Decision

- **`ui-model-selection` ModelSelect 菜单：** 打开的菜单现在在绘制前及每次 resize 时根据触发器边界矩形定位——`placeMenu()` 保留首选"右对齐且向上展开"的放置方式，然后把两个轴都钳制到视口（8px 边距），当上方空间不足时翻转到触发器下方。结果以 root 相对坐标的 `left`/`top` 内联样式给出（并显式设置 `right`/`bottom: auto`，避免 CSS 默认值把自适应高度的卡片拉伸），因此菜单始终绝对锚定在触发器上并随其滚动。`null` 保留 CSS 默认值用于绘制前的唯一一帧。
- **`ui-primitives` Menu 卡片：** 共享的 `.list`/`.submenu` 表面现在带有 `max-width: min(360px, calc(100vw - 24px))`，因此任何菜单卡片都不会比视口更宽（24px = portal 边距的两倍）。

## Alternatives considered

- **像 `Menu` 原语的 portal 模式那样，为模型菜单采用 portal + fixed 定位：** 否决——该席位的菜单是自定义两级表面（root/model/effort 面板、搜索、分组列表），且创作器刻意避免祖先 transform（见 `ConversationRoot.module.css`），因此针对 `.root` 的绝对定位加钳制坐标更简单，并随触发器免费滚动。
- **纯 CSS 防护（视口受限的 `max-width`、`overflow`）：** 否决用于水平放置——纯 CSS 无法获知触发器位置，因此只有宽度上限可用 CSS；位置钳制必须用 JavaScript。

## Consequences

应用中的任何弹出层都不会在移动端溢出屏幕：模型菜单会钳制并在必要时翻转，`Menu`/`Select` 卡片则在任何位置都受宽度约束。空间充足时模型菜单保持既有几何（右对齐、向上展开），因此桌面放置不变。钳制只在 resize 时重新运行；菜单打开期间绝对定位会随锚点在滚动时一起移动，这正是 portal 模式用更多机制重新创建的锚定菜单行为。

## Testing

`packages/client/ui-model-selection/tests/model-select.client.spec.tsx` 以纯函数形式覆盖 `placeMenu`：空间充足时的首选放置、左右边缘钳制、上方空间不足时的下方翻转、两侧都无法容纳时的顶部边距回退，以及 root 偏移换算。全部 25 个 model-selection 测试与 544 个 ui-primitives/rows 测试通过。
