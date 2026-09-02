# Agent Note: 设置分节标题采用统一样式

Status: implemented

[English](2026-08-30-settings-section-heading-unification.md) | 中文

## Problem

各设置分节在自己的 CSS 模块中绘制标题和说明，切换标签时标题块随之变化：Models 标题为 16px/500，Plugins 和 Agent presets 为 18px/600，Access restrictions 为 14px/600；说明文字为 13px 或 14px；容器间距为 12px 或 20px，宽度为 720px、760px 或全宽。切换标签会明显改变布局节奏。

## Decision

设置分节通过 `@deepseek-ai/dsh-client-ui-primitives` 导出的统一 `SectionHeading` 原子组件渲染标题。它在间距 4px 的块内绘制 16px/24、字重 600 的标题和 14px/22 的说明。四个带标题的分节——Models、Plugins、Agent presets 和 Access restrictions（fs-deny）——以它替代自己的 `<h2>`/`<p>` 及逐包 `.title`、`.intro`、`.heading`、`.groupTitle`、`.hint` 规则，移除这些重复规则。各 `.section` 容器统一为 `gap: 12px`、`max-width: 720px`，使内容列对齐。About、General 和 Remote devices 保持原有内容，不受影响。

## Alternatives considered

### 手工对齐各包 CSS

每次设计变化都同步四份模块样式会保留同样的重复劳动；重复规则本身就是缺陷，而不只是症状。

### 由设置外壳拥有标题 slot

将标题移至 Settings 外壳要求每个分节声明并填充新的 owner props，变更范围超出该不一致问题的需要。

## Consequences

标题具有单一事实来源：修改一个组件即可替代修改四份样式，标签不会再次分歧。代价是各分节的自由度缩小：需要专有标题的分节必须退出该组件，而不能只改写一条规则。
