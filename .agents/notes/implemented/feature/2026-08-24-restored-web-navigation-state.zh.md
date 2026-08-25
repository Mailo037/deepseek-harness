# Agent Note: 已恢复的 Web 导航状态

Status: implemented

[English](2026-08-24-restored-web-navigation-state.md) | 中文

## 问题

浏览器会在刷新后保留当前会话选择，但会丢弃已打开的设置面板及其选中分区。因此，即使用户正在某个特定设置分区中工作，刷新后也会回到对话。

## 决定

`SessionRuntime` 继续将所选会话持久化到 `dsh.sessions.current`，并根据新加载的 Host 列表验证该选择。不可用的会话会清除当前选择，因此投影为 New Session 视图，而不会保留无法使用的目标。

`ui-settings-general` 拥有一个以 `dsh.settings.navigation` 持久化的 root-scoped `SettingsNavigationStore`。它的 `open` 和 `select` 操作独立于会话数据和设置文档，保留可见面板及最新分区 id。`close` 会清除这两个值，因此只有当前已打开的设置视图会在浏览器刷新后恢复。

若持久化分区尚未注册，设置面板会渲染第一个可用分区。它会保留已存 id，使动态加载的分区注册能恢复请求的视图，而无需改变持久化的浏览器状态。

## 考虑过的替代方案

**URL fragment 和浏览器历史路由。** 未采用，因为设置面板是模态视图而非可路由页面，地址栏导航需要共享、后退／前进和链接兼容语义，超出了恢复一个浏览器当前视图的范围。

**与 SessionRuntime 共用一条导航记录。** 未采用，因为设置是 root-scoped，即使没有已选会话也有意义；耦合会让缺失会话清除无关的查看状态。

**组件本地 React state。** 未采用，因为组件 state 无法在完整浏览器刷新后重新加载，也无法跨 root 条目的生命周期保留。

## 结果

刷新已有会话会恢复该会话；若刷新时持久化会话已消失，则打开 New Session。设置处于打开状态时刷新会恢复面板及其所选分区。`sessions-service.client.spec.ts` 固定缺失会话回退，`settings-root.client.spec.tsx` 挂载一份重新创建的持久化设置 store，以固定面板和分区的重新加载。
