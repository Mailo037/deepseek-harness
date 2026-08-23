# Agent Note: Web GUI 全局键盘快捷键

Status: implemented

[English](2026-08-23-web-keyboard-shortcuts.md) | 中文

## 问题

Web GUI 此前没有任何全局键盘快捷键：仅有的组合键都是组件作用域内的（composer 中的 Cmd/Ctrl+Enter、对话框中的 Escape、菜单中的方向键）。两个产品级动作——切换侧边栏列与新建会话——只能靠鼠标操作，而 `Ctrl+N`（「新建会话」的自然组合键）在浏览器中无法生效：所有浏览器都将其保留给「新建窗口」，绝不会把 keydown 交给页面。当时根本没有可供扩展的快捷键表面。

## 决策

新增客户端插件包 `@deepseek-ai/dsh-client-ui-shortcuts`（仅浏览器半区，无 slot、无 store）：在插件 fiber 生命周期内绑定一个 document 级 `keydown` 监听器，把两个固定组合键派发到侧边栏按钮使用的同一批服务：

- `Ctrl/Cmd+B` — 切换侧边栏列（`ctx.layout.toggleSidebar()`）。
- `Ctrl/Cmd+Shift+S` — 新建会话（`ctx.workspaces.startSession()`）；用 Shift+S（S = Session）取代被浏览器保留的 `Ctrl+N`。
- `Ctrl/Cmd+.` — 打开详情面板（`ctx.layout.openDetails()`；已打开时为 no-op）。
- `Ctrl/Cmd+Shift+F` — 聚焦 composer 输入（文档中第一个可编辑 textarea；对话框打开时优先聚焦其中的 textarea）。

组合键必须精确匹配（主修饰键、不带 Alt、每个组合键各自的 Shift 状态），因此无关组合键不会落入本插件手中。重复按键与输入法组合态永不触发（长按重复会快速翻转侧边栏；组合中的按键是输入文本，不是命令），已被处理的事件则让位给接管它的组件级处理器——composer 在自己按键上保持优先。监听器在 apply 时绑定，fiber 销毁时移除。

该包以 `dsh.client` 行注册进 web-app bundle 名册，与其他表面插件一样随浏览器树加载。没有面向用户的改键界面；组合键是该插件中的常量。

## 备选方案

- **用 `Ctrl+N` 新建会话。** 否决：浏览器将其保留给「新建窗口」，页面永远不会收到该 keydown，组合键无法生效。
- **把监听器放进 ui-layout 或 ui-sidebar。** 否决：快捷键是横切表面，不是布局框架或侧边栏外壳的职责；独立包把组合键及其 IME/优先级策略集中在一个自有位置，符合「一个功能一个插件」的约定。
- **提供设置项来改键。** 本次交付否决：固定组合键与 composer 硬编码 Cmd/Ctrl+Enter 的先例一致；改键需要设置界面与按键存储，对首次交付价值不大。

## 影响

两个产品级动作现在都有了与按钮同等权威的键盘等价物，该插件也是未来新增全局组合键（命令面板、工作区切换器）的唯一落点。代价：两个组合键是固定的产品常量；Firefox 将 `Ctrl+Shift+S` 保留给截图工具，因此「新建会话」组合键在那里不会触发（Chrome、Edge 与 Safari 均未占用）——已在包 README 的「已知限制」中记录。`Ctrl+N` 因浏览器设计而始终不可用。
