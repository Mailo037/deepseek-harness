# Agent Note：强制推理（mandatory-reasoning）强度提升

Status: implemented

[English](2026-08-25-mandatory-reasoning-effort-escalation.md) | 中文

## 问题

一些位于思考模型之前的 OpenAI 兼容网关会拒绝每个禁用或省略推理的请求，返回 HTTP 400，其消息为「Reasoning is mandatory for this endpoint and cannot be disabled」。`dsh-llm-deepseek` 适配器把配置或按请求的 `off` 强度序列化为 `thinking: {type: 'disabled'}`，因此在这类端点上每轮对话都会以原始提供方错误失败，唯一补救是手动修改设置——而用户已经先看到了失败。

## 决策

在同一次 `stream()` 调用内，当非 ok 的 chat 响应中的提供方错误文本报告推理为强制或不可禁用（覆盖「reasoning … mandatory/required」「mandatory/required … reasoning」与「reasoning … cannot be disabled」三组正则）时，适配器把强度沿阶梯提升一档并原地重建请求体：第一次拒绝以 `low` 重试，第二次 `high`，第三次 `max`。失败尝试自身在协议中的 `reasoning_effort` 决定下一档（`undefined → low → high → max`），因此已携带 `max` 的请求不再重试而直接失败。最多重试三次；阶梯耗尽后原始提供方错误原样抛出。`purpose: 'session-title'` 不提升，保留其专用的非思考输出预算。锁定为 `thinking: disabled` 的部署不会悄悄覆盖锁定：序列化被提升的启用档会抛出 `UNSUPPORTED_REASONING_EFFORT`，在第一次提升尝试时就响亮失败。该覆盖是一次调用内的状态——它从不改动已记录的 call config，会话日志仍记录调用方请求的强度，协议上携带的是提升后的值。

## 备选方案

**在 agent-loop 或 `agent/request` 层重试。** 否决：loop 会为一个本质上是传输形态的重试重跑整轮，而且 call config 刻意设计为不可悄悄调整的每次调用旋钮。适配器已拥有同一模式——失效文件恢复就在 `request()` 内重建并重发——所以提升也放在那里。

**把该错误当作静态配置错误直接拒绝。** 作为唯一行为否决：端点是否强制推理是 harness 在 I/O 前无法发现的部署属性，用户侧诉求是恢复而非诊断。存在锁定的场景仍保持响亮失败语义。

## 后果

强制推理的网关现在能从 `off` 默认值在一次 stream 调用内成功，只在首个轮次多付至多三个 HTTP 请求。检测与现有的失效文件、规范化图片匹配器一样基于文本，因此包含这些短语的无关错误可能触发一次提升，但最终仍会原样暴露同一错误。`packages/llm/llm-deepseek/tests/adapter.spec.ts` 固定了阶梯（off → low → high → max）、阶梯耗尽且保留原始错误、已达 max 不重试，以及无关 400 不提升。
