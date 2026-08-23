# Agent Note: Chat header more-options menu, mobile off-frame sidebar, and long user bubble collapse

Status: implemented

[English](2026-08-21-chat-header-options-and-mobile-shell.md) | 中文

## Problem

组装后的 Web 客户端存在三个呈现缺口：粘贴超长提示词的用户会看到不受高度约束的气泡，把整份对话记录挤出视野；在手机尺寸的 frame 上，关闭的侧边栏仍占据 56px 轨道，而唯一的展开可供性就藏在这条轨道里；当前会话的管理动词（重命名、fork、移动到其他 workspace、归档、下载日志）要么只存在于侧边栏浏览器的逐行菜单中，要么是页头上一枚松散的 `Session log` capsule——管理打开中的会话必须先找到它的行，或瞄准第二个控件。

## Decision

- **超长用户气泡折叠**（`ui-conversation`）：`UserStyleBubble` 的正文经 `ClampableBubbleBody` 渲染，后者以内容数组为键、在布局同步的 effect 中测量正文的 `scrollHeight`。超过 264px 时以 240px 钳制并向气泡填充色渐隐，附一枚本地化开关（显示更多/收起）；点击即原地展开。pending steering 复用同一组件，因此增长中的预准入插话会重新测量。
- **移动端完全离场侧边栏**（`ui-layout`）：在 `SIDEBAR_DRAWER_BREAKPOINT` 以下，关闭的侧边栏贡献零宽 grid 轨道而非 56px 轨道（frame 属性 `data-sidebar-offframe`；求解后的中栏吸收轨道宽度）。AppFrame 渲染唯一的展开可供性——经新增 `layout` locale 命名空间本地化的左上角浮动控件；打开仍走既有的抽屉覆盖。抽屉断点与 `SIDEBAR_AUTO_COLLAPSE` 之间的轨道行为不变。会话页头通过一条 `data-sidebar-offframe` CSS 规则为角落按钮让位。
- **页头更多选项菜单**（`ui-workspace`）：第三个注册 `SessionOptionsAction` 进入 `conversation.session.header.utilities`，通过注入动词提供当前会话的重命名/fork/移动/下载/归档——重命名走 `session.rename`，fork 走 `sessions.fork({ increaseTitle: true })`，移动与归档走 workspaces 服务，下载经导出特性的 `sessionLogDownload` 控制器（`ctx.get`，按设计可选）。下载行在该会话导出进行中时禁用（经 inject `hooks` 腔隙读取控制器 store）；组合中未挂载导出器时该行直接消失。导出包自身的 `Session log` capsule 已移除——其注册现在只挂载共享结果对话框，使所有触发面在同一处报告准备/成功/失败。重命名与移动对话框是组件本地状态，切换会话时会连同其目标一起丢弃未完成的编辑。空白的临时会话不渲染入口，与行菜单规则一致。

## Alternatives considered

- **硬编码展开按钮的 aria-label** 而非给 ui-layout 增加 locale 席位：落选，因为产品文案处处经由 locale 字典，且布局包本就以 dev 依赖持有 locale 插件。
- **把移动端展开按钮渲染进会话页头**（一个 session 作用域 slot）：落选，因为 hero／无会话状态没有页头，会让部分屏幕失去任何展开可供性；几何决策归框架所有，按钮也应归框架所有。
- **真正的 host 侧会话删除**：本次落选——传输面只有 `workspace.archiveSession`，不存在会话删除 RPC；归档（从所有分组面隐藏、日志保留）是既有的准破坏性动词，菜单因此采用它。
- **在菜单旁保留 `Session log` capsule**：落选，因为同一动词的两个触发点正是本入口要清除的页头杂乱；capsule 的独有价值——其结果对话框——仍由它自己的注册挂载。

## Consequences

手机尺寸 frame 上关闭侧边栏的轨道彻底消失，任何依赖悬停轨道图标之处都必须改用新的角落按钮。`conversation.session.header.utilities` 仍承载两个出厂条目——导出特性的纯对话框挂载与本菜单；ui-workspace 现在对导出包持有类型依赖（peer + dev + 清单 edge），同时在 apply 期经 `ctx.get` 解析其控制器，因此未挂载导出器的组合可以正常启动，只是没有下载行。气泡折叠阈值是呈现常量（264/240px），不是配置项；它与气泡规格中的其余固定几何一致，属于有意固定。`ui-layout`／`dsh-client-connection` 与 `ui-shell-command`／`dsh-client-ui-slots` 清单上既有的校验器违例仍然存在，属于另一批进行中的工作。

## Testing

`packages/client/ui-conversation/tests/chat-bubble-collapse.client.spec.tsx` 固定钳制/展开/重测量行为（在 HTMLElement 原型上替身 scrollHeight）；`packages/client/ui-workspace/tests/session-options.client.spec.tsx` 覆盖空白抑制、直接的 fork/归档/下载分发、进行中禁用的下载行、无导出器时的行消失以及两个对话框；`packages/session-query/session-log-export/tests/client-apply.client.spec.tsx` 固定纯对话框挂载；`packages/client/ui-layout/tests/app-frame.client.spec.tsx` 在抽屉套件中补充离场轨道、角落按钮与断点之上保留轨道的行为。
