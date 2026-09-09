# Agent Note: Web @-menu domain icons and the create_session chat-start tool

Status: implemented

[English](2026-09-02-reference-menu-icons-and-session-start-tool.md) | 中文

## 问题

Web 编辑器的 `@` 菜单用文字前缀（`File ·`、`Folder ·`、`Session ·`）标注每一行引用候选，而 `/` 菜单为每行渲染领域图标——两个菜单并排却各说各话，且前缀与分组标题（`文件与文件夹`、`Session 对话`）重复表达同一事实。另一方面，当用户要求把工作移交到新聊天时，agent 没有产品级路径：跨会话读取只是一个可选挂载的工具包，任何 shipped preset 都没有装配它；而开启新聊天是浏览器独有的手势，模型既不能请求也不能执行。

## 决策

`@` 菜单改用 `/` 菜单的图标语言。`InputTriggerCandidate` 新增 `appearance` 字段（`'session' | 'file' | 'folder'`，与 `ReferenceInsert` 已有的联合一致），`MenuView` 对设置了该字段的候选项渲染领域图标以取代文字前缀。ui-reference source 不再拼接 `File ·`／`Folder ·`／`Session ·` 标签，改为逐行打标；文件夹／文件／聊天图标与编辑器里已落地引用装饰用的是同一批字形，因此菜单行与它插入的 token 现在携带一致的标记。

跨会话读取默认发货：`standard`、`code`、`cordis` 三个 agent preset（两份 app 副本）都挂载 `@deepseek-ai/dsh-tool-session-query`，其六个工具本就按调用会话的工作区授权每次读取并约束输出。Web bundle 的 `session-query-sqlite` 行从 `openAt: never` 改为 `first-search`，会话级搜索工具因此可调用，而宿主启动仍然不导入 node:sqlite。

开启聊天成为面向模型的工具：新增宿主面的 `@deepseek-ai/dsh-tool-session-start` 注册 `create_session`，仅由 shipped web-app bundle 挂载。工具从调用会话推导目标——登记的所在工作区，否则其记录的 cwd——并沿用其 preset 组合（`inheritPreset` 配置，默认 `true`），然后在调用网关之前先走审批环节，因此聊天诞生只会发生在用户显式确认之后。创建本身走 `ctx.apiProxy.sessions.create`，与浏览器"新会话"按钮驱动的是同一条路径；网关的 `ensureSession` 去重和 `host/session-added` 帧意味着侧边栏得知工具创建的聊天与得知 UI 创建的聊天方式完全一致。子代理调用者被拒绝（只有顶层聊天能再开聊天）；缺少审批服务时直接拒绝而非降级；任何非放行结果都会产生错误结果且不创建任何会话。

## 备选方案

**以图标字符串塞进候选的 `icon` 字段。** 否决：`icon` 是自由字符串席位，菜单仍需按 source 逐个映射字形；类型化的 `appearance` 联合复用引用词表，按构造保证菜单行与插入 chip 一致，同时把 `icon` 留给自带私有字形的 source。

**给 `create_session` 加首条消息参数。** 否决：网关的 `session.create` 不接受 prompt，若再调一次投递会与用户打开聊天竞速；产品意图是让用户写入的空聊天，而不是 agent 预填内容。

**工具侧自行挂接工作区，不走网关创建。** 否决：直接调 `ctx.agents.create` 会分裂会话创建路径，绕过网关的 preset 冲突检查、cwd 冲突去重和 `host/session-added` 流——浏览器已经依赖的三个行为，第二条路径会静默偏离。

**静默创建后发通知。** 否决：新增的侧边栏行是工具结果卡片之外的用户可见界面变更，所以它走审批环节而不是 `agent.inject` 上下文；审批提问也正好是告知用户聊天将出现在哪个工作区的位置。

## 后果

两个触发菜单共享一套视觉语法，`reference` locale 命名空间里的旧标签词（`candidate.file`／`candidate.folder`／`candidate.session`）连同 README 的相应说法一并移除。每个 shipped Web agent 现在无需部署方选择即可搜索并读取自己工作区内的历史会话，代价是临时 SQLite 索引从"永不打开"变为"首次搜索时打开"。agent 只能通过审批门控、仅 Web 挂载的工具为用户开启聊天，且该工具既不导航用户视图也不搬运历史——任务委派仍归 subagent 工具，工具描述里写明了这一点。

断言 `File ·`／`Session ·` 前缀的既有 web e2e golden 与组件规格随行为一起更新；`apps/web/tests/reference-composer.e2e.ts` 现在按名称与图标数量断言候选行，菜单 golden 不再含前缀文本。
