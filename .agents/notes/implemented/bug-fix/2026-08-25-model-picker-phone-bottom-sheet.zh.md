# Agent Note: Model picker phone bottom sheet

Status: implemented

[English](2026-08-25-model-picker-phone-bottom-sheet.md) | 中文

## Problem

在手机 viewport 上，composer 的模型选择器渲染为一张绝对定位卡片：宽度横跨 viewport 但四周各留 8px 边距，始终从 trigger 向上展开，高度上限 `100vh - 96px`。结果被裁切：搜索框落在浏览器 chrome 之下，而目录里有多个提供商分组时，最后几行越过折叠线且无法触及。由于卡片盖住了 viewport 下半部，点按其外部也不可靠——唯一的关闭手势是可能点空的“外部点击”，以及手机上并不存在的键盘 Escape。

## Decision

在既有 639px 手机断点以下，打开的菜单是一块锚定在 viewport 底边、由 `--sheet-h` 自定义属性设定高度的 `position: fixed` **底部面板**。它静止在半屏高度（`50dvh`），可向上拖至近全屏（`92dvh`），被拉过四分之一高度阈值时关闭。面板顶部边缘的拖拽把手 `.sheetHandle` 抓取区驱动高度：拖动时指针处理器把 `--sheet-h` 直接写入 DOM，使面板跟手而不必每帧重渲染；松手后经 `height` 过渡弹回静止或展开位置（越过关闭阈值则关闭）。`setPointerCapture` 有守卫，因为 jsdom 提供一个会抛错的桩。放置 layout effect 的手机分支不持有任何几何：只发布一个 `{ sheet: true }` 哨兵让面板在首帧即显示，不创建 `ResizeObserver`，也不监听 resize。一条头部行（`menu.aria` 标题加上尾侧 32px 关闭按钮）仅在 `phone` 时渲染；它走与桌面下拉相同的 `close(true)` 路径并把焦点还给 trigger。模型列表在手机上获得 `flex: 1 1 auto`，从而在把手、头部与搜索框之下的空间内滚动，而不是撑大面板。`--sheet-h` 的弹回目标用 `100dvh`，使屏幕键盘收缩动态 viewport 时展开的面板仍保持在屏内。

## Alternatives considered

**保留此前的全屏覆盖层，仅加一个关闭按钮。** 拒绝：选择器无需接管整屏，半屏面板让 composer 仍在其上可见，并提供手机触摸可供性所期望的“下拉关闭”手势。

**保留带边距的横跨卡片，仅抬高其高度上限。** 拒绝：卡片顶部仍锚定在 trigger 矩形上，长目录时搜索框依旧被浏览器 chrome 遮住，且目录一旦超过上限，折叠线问题就会重现。

**手机端把菜单 portal 到 `document.body`。** 拒绝：composer 栈本就刻意避免 transform 祖先，使 `position: fixed` 后代能覆盖整个 viewport（ConversationRoot 的 `.composerHero`），因此纯 CSS 的 fixed 面板不需要 portal、焦点陷阱接线，也不新增模块图边。

## Consequences

选择器成为一块静止于中屏、向上拖拽即展开的手机底部面板——贴合移动端抽屉/面板惯例——而不是此前迭代的整屏接管。点按外部仍可关闭它（outside-mousedown 处理器覆盖面板上方的 composer 区域），头部关闭按钮与 Escape 仍分别作为指针与键盘可访问的关闭途径。桌面下拉保持其经测量、按 viewport 钳制的放置不变；`model-select.client.spec.tsx` 钉住手机分支（无内联放置、无 `ResizeObserver`、resize 与 pane 切换下几何稳定），并覆盖静止、展开与关闭三条拖拽路径。
