# @deepseek-ai/dsh-client-ui-shortcuts

[English](README.md) | 中文

全局键盘快捷键插件（浏览器端部分）：一个 document 级 keydown 监听器把固定的组合键派发到与按钮相同的客户端服务。本插件不渲染任何内容，也不持有 store。`Ctrl+N` 不能用于「新建会话」——浏览器将其保留给「新建窗口」，永远不会把它交给页面——因此组合键采用 `Ctrl/Cmd+Shift+S`（S = Session）。

- `Ctrl/Cmd+B` — 切换侧边栏列（展开 ⟷ 收起）。
- `Ctrl/Cmd+Shift+S` — 新建会话（与侧边栏「新建会话」按钮同一流程：显式、当前会话或最近工作区的空白会话；都不存在时进入空白的新建会话视图）。
- `Ctrl/Cmd+.` — 打开详情面板（右侧工具/详情列；已打开时为 no-op）。
- `Ctrl/Cmd+Shift+F` — 聚焦 composer 输入（文档中第一个可编辑 textarea；对话框打开时优先聚焦其中的 textarea）。

两个组合键都要求恰好按主修饰键：不带 Alt，且每个组合键的 Shift 状态必须一致。重复按键与输入法组合态不触发；`defaultPrevented` 的事件让位给已接管它的组件级处理器，因此 composer 自身的按键保持优先。监听器在 apply 时绑定，并在 fiber 销毁时移除。

## 模型体验

无，因为组合键只调用客户端动作（`layout.toggleSidebar()`、`workspaces.startSession()`、`layout.openDetails()` 与一个 DOM 聚焦），不触及任何模型请求。

#### KV Cache 影响

无；本插件既不组装也不发送 provider 请求。

## 已知限制与暂缓事项

- **`Ctrl+N` 被浏览器保留**——用于新建窗口，永远不会交给页面。因此「新建会话」使用 `Ctrl/Cmd+Shift+S`；页面无法收回 `Ctrl+N`。
- **Firefox 将 `Ctrl+Shift+S` 保留给截图工具**——该组合键在那里不会触发。Chrome、Edge 与 Safari 均未占用它。
- **组合键固定**——没有面向用户的改键界面；调整它们是本包的代码改动。
