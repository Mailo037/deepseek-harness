# Agent Note: 持久化的会话文件编辑统计

Status: implemented

[English](2026-08-25-durable-session-file-edit-stats.md) | 中文

## 问题

聊天统计条此前展示 token、墙钟时间与计数，但没有能熬过历史分页的文件影响总数。按轮次界定的[编辑器行变更摘要](2026-08-24-composer-line-change-summary.zh.md)只覆盖浏览器已加载的窗口，且其决策刻意拒绝了“超出此 UI 需求”的全日志 Host 投影——因此没有加载完整聊天的读者看不到本次会话编辑了多少文件与行。

## 决策

`@deepseek-ai/dsh-session-stats` 把文件编辑总数折叠进已有的全日志 `sessionStats` 投影。其 `tool/result` 处理现在也读取变更工具附加到 `event.data.meta` 的结果级 diff（`dsh-tool-fs` 写入 `{ diffs: [{ path, oldText, newText }] }`），并发布三个新视图字段——`filesEdited`、`linesAdded`、`linesRemoved`——在整个日志中对路径去重，并按与客户端 diff 卡片相同的终止符规则计数。只有与已记录 `tool/call` 配对的结果才贡献，与现有 `toolMs` 规则一致，因此无调用配对的崩溃恢复结果不计任何内容。持久化缓存状态现在也多保留一份 `editedPaths` 记录；单元的 `stateVersion` 升至 2。

编辑器统计条（`StatsLine`）在投影提供正数 `filesEdited` 时追加文件编辑分组——本地化为 `{files} files · +{linesAdded} · -{linesRemoved}`（中文 `{files} 个文件 · +{linesAdded} · -{linesRemoved}`）。由于统计条已通过 `useProjection` 读取持久的 `sessionStats` 投影，该分组与现有计数、token 分组一样熬过分页与压缩；无单元时的窗口回退（`deriveStats`）不计算编辑，因此没有投影的装配不会伪造计数。

## 备选方案

**从已加载窗口在客户端计算总数。** 窗口折叠会随加载页数重算，并隐藏任何落在已加载后缀之外的文件——这正是投影存在的意义所在的分页隐患。持久投影是唯一能从第一个尾页就回答“本次会话编辑了多少文件/行”的读数。

**改把编辑加入按轮次界定的 `LineChangeSummary` 展开面板。** 该对话框报告可见窗口的按路径明细；本需求是统计条中的全会话总数。两个表面共用同一套 `dsh-tool-fs` diff 词汇，但页脚的这一行是持久聚合的家，展开面板仍是可浏览的明细。

## 后果

统计条现在无需加载历史即可报告全会话的文件影响，满足了“全局追踪器”的需求。每个 web 尾页与列表行多携带一组小键（`filesEdited`、`linesAdded`、`linesRemoved`），单元状态在每次配对的 `tool/result` 时变化，因此变更流会多发几帧。没有文件编辑的会话不显示该分组（不会渲染误导性内容）。[编辑器行变更摘要](2026-08-24-composer-line-change-summary.zh.md)不变：其按轮次界定、仅浏览器的展开面板仍是明细视图，现在由持久的全会话页脚总数补充。投影单元测试钉住不同文件去重、行总数、新建与编辑的处理以及“必须配对”规则；统计条测试钉住分组渲染及其零值隐藏。
