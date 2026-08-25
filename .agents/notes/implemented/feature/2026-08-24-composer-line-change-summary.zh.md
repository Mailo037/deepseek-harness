# Agent Note: Composer 行数变更摘要

Status: implemented

[English](2026-08-24-composer-line-change-summary.md) | 中文

## 问题

每个修改工具行都会显示自己的新增与删除行数，但读者必须逐个打开并相加，才能看到任务对文件产生的累计影响。

## 决定

`@deepseek-ai/dsh-client-ui-deliverables` 将成功 result-time diff hunk 作为 `DeliverablesTurnData.lineChanges` 记录在既有产出路径旁。Composer 侧的 `LineChangeSummary` 读取已组装的 Chat timeline，保留路径首次出现的位置，并把同一路径之后的 hunk 相加。它在居中的 `conversation.input.dock` trigger 中显示变更文件数量以及绿色 `+`／红色 `-` 总计；打开后 chevron 朝上，受限且可滚动的 dialog 依次显示文件名、圆点、完整路径以及该路径总计。Escape 与外部 pointer 输入都会关闭 dialog。

call-time diff intent 与通用 `edit` location 不进入摘要。result-time diff hunk 是已应用的展示数据，而另外两种形式无法保证精确的行数。摘要仍是纯浏览器 projection：它不会新增 Session event、Host projection、请求或模型可见输入。跨分页历史的全会话总计——不同文件以及新增/删除行总数——则由持久的 `sessionStats` 投影与聊天统计条另行提供，不属于本 disclosure（[持久化的会话文件编辑统计](2026-08-25-durable-session-file-edit-stats.zh.md)）。

## 考虑过的替代方案

**从 pending call view 累加计数。**call view 可以描述预期覆盖，而非已应用的上下文变更，因此其总计可能与已完成的 DiffBlock 不一致。

**把 disclosure 放进 Composer 工具行。**文件影响描述的是已完成工作，并且需要多行路径列表；input dock 提供一条稳定且居中的独立空间，不与发送控件竞争。

**发布 whole-log Host projection。**现有 Deliverables 数据与 Chat timeline 已能回答可见的浏览器视图。持久 projection 会增加第二个属主，并作出超出本 UI 请求的完整历史精确承诺。

## 后果

轮次末尾文件 chip、最终回复链接与 Composer 摘要仍处于同一个 Deliverables 功能边界。摘要只表示浏览器已组装 timeline 内的 result-time diff；通用 edit location 和未加载历史保持缺席，而不会获得虚构总计。`produced-files.client.spec.tsx` 验证 result-diff 累计、重复路径合并、disclosure 行为与注册清理；`apps/web/tests/produced-files.e2e.ts` 重放已组装的 Web 会话及其无障碍 disclosure。
