# Agent Note: Web composer 的 slash token 来自带域的 lexicon

Status: implemented

[English](2026-08-23-web-composer-slash-token-lexicon.md) | 中文

## 问题

在 `/` 菜单中选中 skill 或 command 后，composer 草稿里的 `/name` token 只呈现为无图标的有色文字；而且手敲的命令名完全没有装饰——此前只有 skill 实现了 slash 流水线的 `lexicon` 钩子。读者无法一眼区分 skill token、命令 claim 与普通文本。

## 决策

lexicon 名录成员现在是裸字符串或 `{ name, appearance }`，其中 `appearance` 为 `'skill' | 'command'`。ui-skill source 给其目录条目标注 `skill`；`/` 命令 source 首次实现 lexicon 钩子，返回可解析的宿主命令加当前可用贡献项并标注 `command`，结算通知走新增的 `CommandDirectory.snapshot`／`onSettle` 成员。装饰扫描把每个命中的 token 映射到其域外观并渲染为带图标的胶囊（`ReferenceIcon` 新增 `skill` 与 `command` 两种）；同名冲突的外观解析为 `command`，与裁决优先级一致。被 claim 的命令 token 保留 warn 高亮，同时获得同样的前导图标。

这是对明文引用决策（[web input machine and slash pipeline](../architecture/2026-07-25-web-input-machine-and-slash-pipeline.zh.md)）的扩展，不改变任何序列化：pick 仍落地字面文本，提示词发出的也是同一段字面文本。

## 考虑过的替代方案

**命令改用结构化 reference occurrence。** 否决：命令已通过 claim 与 popup 拥有自己的生命周期；occurrence 身份会引入当前没有消费者的删除与回放机制。

**由 composer 按已知名字推导域。** 否决：composer 无法仅凭形状区分 skill 与 command，在那里硬编码名字清单会复制各 source 的目录。

## 后果

skill 与 command 在草稿中读作两种不同的 token，且菜单选中与手敲两种入口视觉一致。lexicon 约定原地加宽，既有的裸字符串名录仍然有效。包测试固定了命令名录的冷/热会话轴、贡献项可用性过滤与结算扇出。
