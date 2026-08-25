# Agent Note：侧边栏下拉刷新重载整个浏览域

Status: implemented

[English](2026-08-25-sidebar-pull-to-refresh.md) | 中文

## 问题

移动端侧边栏没有任何办法在 Workspace 或 Session 基线加载不完整或过期后重新执行初始加载。重连是唯一的完整重载路径，且用户无法主动触发；用户只能刷新整个页面。

## 决策

`WorkspaceBrowser`（`sidebar.workspaces` 区域）在宽浏览列表上新增仅触屏的下拉刷新手势。手势在触摸下拉起点位于 `scrollTop === 0`、移动方向以纵向为主且下拉超过 8px 时接管；期间显示随下拉高度展开的指示条，文案为本地化的「下拉刷新／释放刷新／正在刷新…」，松开时下拉超过 64px 即触发重载。

该重载是新的运行时能力，而非仅 UI 局部的刷新：

- `ISessions.refreshAll()`——会话服务新增的对外面成员，实现为 `SessionManager.reloadAll()`，精确复用重连路径（`handleConnected`）所运行的每次连接代重建：`session.list` 基线拉取、所有已消费的子代理目录刷新，以及每个已打开会话窗口的 resync。
- `IWorkspaces.refresh()`——现有 `WorkspaceRuntime.refresh()` 基线拉取，现在出现在对外面上，使功能插件可以调用它。

`ui-workspace` 的 apply 把 `refreshAll`（两个服务并行）接入浏览器注入的 actions。下拉指示条遵循减少动态效果偏好，列表上的 `overscroll-behavior-y: contain` 阻止浏览器原生页面下拉刷新与手势串联。

## 备选方案

**只暴露列表刷新。** 用户要求「全部」——如果加载坏了，已打开的窗口也可能坏了。复用重连重建可以保持「完整重载」只有一个定义，而不是一个更弱的仅列表变体。

**用可见刷新按钮替代手势。** 移动端下拉刷新正是用户要求的平台惯例；按钮也能实现，但会增加区头元素，且与请求不符。

## 影响

`SessionManager.reloadAll()` 现在是重连与用户手势背后的单一实现；`handleConnected` 委托给它。`ISessions`／`IWorkspaces` 面的扩展要求测试替身（`TestSessions.refreshAll`、`TestWorkspaces.refresh`）实现新成员——它们以记录型惰性调用实现。运行时覆盖：manager spec 验证 `reloadAll` 重新拉取基线并 resync 已打开的窗口，sessions-service spec 验证 `refreshAll` 入口。UI 覆盖：`workspace-browser.client.spec.tsx` 验证下拉文案、释放触发、未达阈值的取消，以及横向移动的防护。
