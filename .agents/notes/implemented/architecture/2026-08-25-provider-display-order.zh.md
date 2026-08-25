# Agent Note: 提供方显示顺序

Status: implemented

[English](2026-08-25-provider-display-order.md) | 中文

> 范围：Models 设置页与模型选择器中的用户自定义提供方顺序，在 [web 配置平面](2026-07-30-web-config-plane.zh.md) 之上新增一条持久化偏好及其 Host 侧应用。

## Problem

Models 设置页的提供方顺序遵循可配置提供方目录的声明顺序，模型选择器的分组则遵循适配器注册顺序——这两种自然顺序用户都无法更改。页面无法排列用户实际使用的提供方，选择器展示的也只是先注册的适配器。任何用户偏好都需要一个持久的存放位置，且两个界面必须读取同一顺序，以免「在这里排列」与「在那里展示」产生漂移。

## Decision

**Models 设置插件拥有一个 `models` settings namespace，承载 `providerOrder`（提供方路由 ID，第一名 = 最前）。** 其 Node half 通过 `ctx.inject(['settings'], …)` 注册该 namespace，schema 为 schemastery 的 `z.object({ providerOrder: z.array(z.string()) })`；namespace 名称就是页面与 Host 读取它所用的线路契约，与客户端 settings 写入按名称寻址 namespace 的方式完全一致。

**偏好由 Host 在两个组装点应用，而非浏览器。** `api-proxy` 通过 `sortByProviderPreference` 对 `llm.providers` 的视图和 `buildModelCatalog` 的分组（`session.models` 与 `llm.models` 共用后者）排序：已列出的 ID 按偏好顺序排在最前，其余按自然相对顺序排在后面。在 Host 侧排序让 settings 镜像、设置页行序与作曲家的模型菜单共用一个顺序，无需让两个客户端包各自再维护一个事实源。

**Models 页面为每一行卡片渲染拖拽手柄。** 折叠状态的行卡片本身就是拖拽源（与侧边栏会话行一致），悬停目标行时其上方或下方会出现箭头插入标记（`--dsw-alias-state-business-primary`），提示落点位置；键盘用户可用手柄上的 ArrowUp/ArrowDown 完成同样移动——沿用 QueueDock 的既有手势。展开的编辑器会让该行保持不可拖拽，从而保证其中的文本输入框仍可选中文本，但手柄仍可从 grip 图标发起拖拽。每次移动都会以 namespace 当前 revision 通过 `settings.update` 持久化完整的可见行卡片 ID 序列，然后重新加载联接；被拒绝的写入会以告警行呈现，行序保持不变。首次运行姿态的设置卡不是拖拽目标，只读设置文档会禁用所有手柄。

## Alternatives considered

- **在两个界面各自客户端排序** —— 每个界面都要重新排序其线路回显，`ui-settings-models` 与 `ui-model-selection` 会重复读取偏好，线路顺序也将失去意义。Host 是两个界面的唯一事实源，因此偏好在响应组装处应用。
- **在每个 profile 上增加排序字段**（每个 profile 一个 `order` 数字）—— 顺序会散落在各个提供方 namespace 中，新提供方的位置也需要处处补默认逻辑；一个有序 ID 列表放在单一偏好分节里，每次手势只是一次原子写入。
- **通过 llm 目录注册来重排** —— 目录顺序是适配器所有的声明顺序；为单个用户的偏好改动它，等于把展示逻辑渗入适配器拓扑。

## Consequences

偏好是持久的（`settings.yaml` 会新增 `models:` 分节）、实时生效的（`applies: 'live'`），任何未来的界面都可以通过同一份 `llm.providers`/`llm.models`/`session.models` 响应读取它。没有存储位置的提供方——之后才激活的休眠路由、新声明的路由——会排在自然末尾，直到用户把它拖到合适位置，这让列表始终自包含。键盘路径与拖拽路径共用同一个 `moveRow`/`persistOrder` 实现，因此 e2e 固定键盘手势，组件套件固定拖拽事件、放置目标高亮、同位空操作、失败呈现与只读禁用。Host 侧排序由 api-proxy 规格固定，覆盖偏好存在与缺失两种顺序。无密钥浏览器场景（`apps/web/tests/models-settings.e2e.ts`）现在会把声明的路由重排到已配置路由之上，并同时断言 `settings.yaml` 的写入与重渲染后的行序，ARIA 金样已随新手柄按钮更新。
