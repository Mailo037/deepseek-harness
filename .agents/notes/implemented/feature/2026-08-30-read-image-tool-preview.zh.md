# Agent Note: 读取图片工具预览保持被查看的图片可见

Status: implemented

[English](2026-08-30-read-image-tool-preview.md) | 中文

## Problem

`read_image` 会在面向模型的文本信封旁记录一个持久图片块，但其 Web 工具行使用通用文本展示。被查看的文件因此藏在路径、尺寸、媒体类型、字节数和序列化附件引用之后，尽管图片本身才是读者首先需要看到的结果。

## Decision

`ToolCallTree` 将对话图片 renderer 传给每个 keyed 工具视图持有方。keyed `read_image` 行对成功的已结算结果找到持久图片并通过该 renderer 显示，且请求已有的固定 64px 方形缩略图。选择缩略图仍会打开附件包的原图灯箱。

该行把面向模型的结果信封完整保留在“信息”按钮之后。运行中、失败或没有图片的格式错误结果仍使用标准读取行，保留已有的输出与错误展示。没有会话事件、工具 schema 或渲染意图类型变更：该行读取的就是冻结结果 slice 中已经存在的持久块。

## Alternatives considered

**让每个只有一张图片的历史画廊都变成方形。** 拒绝：消息图片受益于自然但有边界的宽高比，而该工具结果是紧凑的动作回执。持有方因此可以请求已有 tile variant，而不改变普通消息图片的渲染。

**给 `ToolResultView` 新增 image 分支。** 拒绝：持久图片块已经带有需要的附件引用，另一份投影会在工具、Host bridge、runtime 和 UI 间重复该数据。

## Consequences

成功的图片读取以被查看的图片为主，并按需保留技术数据。工具 UI 仍与附件加载实现解耦：它使用对话持有的 renderer，而不导入附件实现或自行解析会话数据。

## Testing

`read-image-row.client.spec.tsx` 固定方形缩略图委托、默认关闭的信息披露和无图片回退行。`message-image.client.spec.tsx` 固定单张图片的强制 tile variant。
