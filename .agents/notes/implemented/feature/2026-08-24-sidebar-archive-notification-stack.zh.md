# Agent Note: 侧边栏归档通知叠层

Status: implemented

[English](2026-08-24-sidebar-archive-notification-stack.md) | 中文

## 问题

侧边栏一次只显示一条内联归档结果。归档另一条 Session 会替换前一条的撤销或重试，因此连续处理多段对话时，用户可能失去较早结果对应的操作。

## 决策

`WorkspaceBrowser` 持有归档结果的侧边栏本地 Motion 卡片叠层。它保留最近三张卡片，水平居中且窄于侧边栏全宽，在紧凑状态保持最新卡片可操作，并且仅在点击叠层或在叠层本身按下 Enter / Space 时展开较早卡片。悬停和键盘焦点进入不会展开。再次点击非按钮区域、叠层外的 pointerdown 或 Escape 会收起叠层；卡片少于两张时也会收起。收起的叠层沿每张卡片上沿绘制一层 token 混合高光。卡片保持较矮，使紧凑叠层贴在侧边栏底部。归档成功提供撤销；归档和恢复失败提供重试；每张未处理的卡片均可关闭。请求进行时卡片操作会禁用，并且每条结果只会在对应 archive 或 restore promise 落定后加入或替换。`AnimatePresence` 和弹簧过渡负责进入、退出和叠层展开；`useReducedMotion` 移除运动效果，同时保留卡片顺序和操作。成功卡片通过 `status` 通知；失败操作通过 `alert` 通知。

## 已考虑的替代方案

**保留一条可变的内联通知。** 否决：后一次归档会覆盖前一次的撤销或重试，而这正是需要叠层的情形。

**添加全局通知服务。** 否决：归档是当前唯一调用方，在第二个消费者出现前将瞬态状态移入另一个插件会形成未被使用的跨功能 API。

## 后果

第四条结果会淘汰最早的卡片；其 Session 仍可从已归档视图恢复。`workspace-browser.client.spec.tsx` 验证两条归档结果同时存在，且撤销会派发最新卡片的 Session id。`archive-notification-stack.client.spec.tsx` 验证仅点击展开、外部与 Escape 收起，以及失败重试路径。`README.md` 记录了位置、展开手势、操作、容量和减少动态效果行为。
