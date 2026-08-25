# Agent Note: Workspace、Preset 与模型选择以及 Workspace 文件夹的电梯式动画

Status: implemented

[English](2026-08-24-elevator-selection-labels.md) | 中文

## 问题

Workspace、Agent-preset 与模型选择 chip 会在原位替换其选择文本，而 Workspace 分组的 Session 会突然出现或消失。直接替换会掩盖哪个紧凑控件发生了变化，突兀的折叠也会打断侧边栏的连续性。

## 决定

`dsh-client-ui-primitives` 中的 `ElevatorLabel` 让首个值保持静止。之后值发生变化时，它会把标签裁切到同一行轨道内，让新值在 260ms 内从上方下行进入，并让前一个值离开到行下方。每次替换都会获得新的 key，因此快速选择也会启动新的一轮动画；轨道则在同一时长内从测得的旧文本宽度插值到新宽度。Hero 的 Workspace chip、新建会话 agent-preset chip 与 composer 模型选择 trigger 都使用这个原子组件。减少运动用户会直接得到替换后的文本，而不产生运动。

`WorkspaceGroupDisclosure` 包裹每个 Workspace 分组中可见的 Session 行。它会在 220ms 内展开或折叠一条裁切的 `0fr`／`1fr` grid 轨道；折叠时只在过渡完成前保留最后的行，并会先把它们设为 inert 且对辅助技术隐藏。减少运动规则会移除该过渡。

## 考虑过的替代方案

**为完整按钮添加动画。** 移动文件夹或 preset 图标以及 chevron 会让选择入口本身看似位移，而不是让变化后的值清晰可读。

**只为进入的标签添加动画。** 旧文本在移动前就被替换会失去电梯式的对应关系，并让快速选择变化看起来像淡入。

**折叠时立即卸载 Workspace 行。** 关闭状态会突然从视图中消失，用户看不到哪个文件夹刚刚折叠。

## 后果

所有选择控件共享同一计时曲线、裁切规则与减少运动行为。chip 仍是原来的按钮，保留既有无障碍名称；只有可见值轨道及其产生的宽度带动画。关闭中的 Workspace 行无法通过焦点或辅助技术访问，并会在固定过渡时长后卸载。`elevator-label.client.spec.tsx` 验证首个值静止、变化值轨道、快速替换身份与减少运动下的直接替换；组件测试验证消费方都渲染运动状态；Workspace 浏览器测试验证折叠行在卸载前先变为 inert。
