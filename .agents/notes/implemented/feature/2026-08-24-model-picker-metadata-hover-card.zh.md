# Agent Note: 模型选择器元数据悬停卡片

Status: implemented

[English](2026-08-24-model-picker-metadata-hover-card.md) | 中文

## 问题

模型行把 modality 显示为各自带边框的徽标，占用了宝贵的行内空间，却没有解释确切路由的 ID 或已公布的容量。

## 决定

`session.models` 现在会在既有输入 modality 与推理元数据旁携带可选的确切路由 `contextWindow` 和适配器配置的 `maxTokens`。提供方选择器把 modality 渲染为无底框图标，并对每个模型行使用共享的 portal `HoverCard`。卡片仅用这些 Host 元数据显示模型 ID、上下文、最大输出和 modality；缺失的值显示为未知。

## 考虑过的替代方案

**从模型名称推断上限。** 名称不是提供方承诺，对自定义路由会展示虚假的精确度。

**保留单独的图标提示。** 它们会重复卡片中的 modality 字段，还会与行级悬停目标竞争。

## 后果

会话模型 wire 增加两个可选且经过验证的正 token 字段。选择器保持紧凑，较长停留会展示确切详情，不改变选择或提示词组装。`api-proxy-models.spec.ts` 验证 wire 投影，`model-select.client.spec.tsx` 验证仅图标的 modality 与悬停卡片数值。
