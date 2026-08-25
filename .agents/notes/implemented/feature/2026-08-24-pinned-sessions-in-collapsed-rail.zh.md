# Agent Note: Pinned sessions remain available in the collapsed sidebar

Status: implemented

[English](2026-08-24-pinned-sessions-in-collapsed-rail.md) | 中文

## 问题

折叠后的侧边栏保留了添加 Workspace 和搜索 Session 控件，却隐藏了展开浏览器最先呈现的固定 Session 导航。为了进入一个固定 Session 而重新展开侧边栏，会让紧凑轨道失去操作者主动设定的快捷入口。

## 决定

`WorkspaceBrowser` 使用与展开状态下「已固定」类别相同的 `derivePinned` 投影生成折叠轨道。它按持久化固定顺序把每个可见固定项渲染为 36px 通用聊天图标按钮，并与添加和搜索控件间隔 12px。右键手势会打开与展开行相同、定位在指针处的 Session 操作菜单。标准 Session 悬浮卡片由每个非空白行和轨道固定项共用：点击标题会将其变为与静态标题排版相同的输入框。Enter 会修剪值并调用现有的 `renameSession` mutation，同时显示进行中状态和内联拒绝错误。当前 Session 还会得到 `aria-current="page"` 和选中视觉状态。选择固定项会直接调用普通 `open` 操作，因此只切换 Session 而不展开侧边栏。缺失、空白、子代理和已归档 Session 仍由 `derivePinned` 排除；不引入新的持久化状态或固定策略。

## 考虑过的替代方案

**先展开侧边栏，再打开固定 Session。** 这只保留一种导航呈现，但会增加轨道原本应避免的过渡，也使固定项不如新建 Session 或搜索直接。

**在轨道中渲染最近使用的 Session。** 最近更新时间不是操作者明确选择的快捷集合，而且会形成第二套独立排序规则。持久化固定项已经表达了紧凑导航应使用的列表。

## 后果

固定 Session 在两种侧边栏宽度下都可进入，且顺序在两种呈现中保持稳定。较长的固定列表会在可用轨道高度内滚动，而非固定 Session 导航仍留在展开浏览器中。`workspace-browser.client.spec.tsx` 验证过滤、顺序、活动状态、内联重命名和轨道右键菜单；`rows.client.spec.tsx` 验证非固定行的相同内联标题行为；`browser-styles.client.spec.ts` 验证轨道几何与滚动规则；`pinned-session-rail.e2e.ts` 在构建后的 Web 客户端中固定菜单到轨道的路径、标题排版、内联重命名和轨道右键菜单。
