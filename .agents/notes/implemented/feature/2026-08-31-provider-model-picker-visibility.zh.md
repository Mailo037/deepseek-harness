# Agent Note: 提供方模型选择器可见性独立于路由

Status: implemented

[English](2026-08-31-provider-model-picker-visibility.md) | 中文

## Problem

已配置的提供方可能累积大量模型目录，但用户可能希望让某条路由继续服务已有会话或显式配置，同时不在普通选择器中提供它的全部模型。

## Decision

Models 设置 namespace 将 `hiddenProviders` 与 `providerOrder` 一起存储。每个已配置提供方行提供「在模型选择器中显示」复选框。Host api-proxy 仅在组装 `session.models` 和 `llm.models` 时排除其中的路由 ID；`llm.providers`、适配器注册表、直接选择和已记录会话选择都保持不变。缺少该列表会解析为一个空列表，因此现有提供方默认全部可见。

## Alternatives considered

**禁用或删除提供方。** 拒绝，因为这也会改变路由，并可能破坏已保存或显式的选择。

**只在 React 组件中隐藏模型。** 拒绝，因为命令选择器和输入框选择器会产生分歧，而且每个客户端仍会收到用户排除的目录。

## Consequences

复选框持久化的是展示偏好，并刷新既有 Models 联接。一个从目录隐藏的提供方仍可由已保存会话或直接配置选择，但不会再出现在任一 Host 目录响应中。

## Testing

定向组件覆盖固定 settings 写入，Host schema 覆盖固定空默认值，api-proxy 覆盖固定目录过滤不会改变 `llm.providers`。
