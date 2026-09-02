# Agent Note: 配额类失败时的多 API 密钥轮换

Status: implemented

[English](2026-08-25-multi-api-key-rotation.md) | 中文

## Problem

提供方插件（llm-deepseek、llm-pi-ai）和 Models 设置页支持每个提供方路由配置多个 API 密钥。一个密钥可能耗尽使用配额，而用户仍有同一端点的另一个密钥（来自不同账户或套餐）。只能把提供方复制为不同路由 ID 的方式会分散 Models 页面，并要求逐路由配置模型。在一个提供方 profile 中添加多个密钥能保留统一配置，并由 harness 透明切换。

## Decision

请求因配额类错误失败时（`QUOTA` code，例如余额不足或达到使用上限），harness 会自动停用失败密钥，并用下一个已配置密钥重试步骤。尝试次数受密钥数量约束：每次失败停用一个密钥，最后一个可用密钥失败后步骤结束。

### 冷却，而非原密钥重试

该机制不同于现有 `llm-retry` 插件的退避策略，后者使用相同凭据重试暂时性失败。密钥轮换处理的是另一类错误：密钥已耗尽，无法在本轮次内恢复，继续使用它也会失败。因此失败密钥进入内存冷却期（默认一小时），下一次请求从配置列表中解析首个未耗尽的密钥。如果所有密钥均在冷却中，仍返回第一个作为回退，让提供方的实际失败呈现出来，而不是 `MISSING_CREDENTIAL`。

### 轮换的归属

该决定分为三个角色：

1. **共享的 `KeyRotation` 助手**（`dsh-llm/src/key-rotation.ts`）——每个提供方一个冷却注册表，可注入时钟以保证测试确定性。纯决策逻辑 `pickRotationRef`、`rotateAfterQuotaFailure` 作为操作此注册表的普通函数导出。

2. **每个提供方插件的 `agent/request-error` 监听器**——各插件（llm-deepseek、llm-pi-ai）注册自己的 waterfall（瀑布式事件）监听器。对于具有已知 `apiKeyRef`（失败请求使用的凭据引用）的 `QUOTA` 失败，监听器停用该引用；只要还有已配置引用可用，就返回 `{kind: 'retry'}`。重试重新执行 agent（智能体）步骤并重新解析凭据，解析器选择首个未耗尽的引用。

3. **每个提供方的凭据解析器**——通过 `pickRotationRef` 选择下一个密钥，过滤当前处于冷却中的引用。

### 触发轮换的错误 code

仅 `QUOTA` code（与提供方无关的账户配额或余额耗尽标准 code）触发轮换。`dsh-llm/src/error.ts` 中既有的 `isQuotaExceededError` 分类器识别 DeepSeek、OpenAI 和通用提供方措辞（例如配额不足、达到使用上限、超出当前配额、余额耗尽或没有剩余额度）。限流（429）和服务器错误仍由现有 `llm-retry` 策略处理。

### 适配器如何报告使用的密钥

`LlmFailure` 接口和 `LlmError` 构造器具有可选 `apiKeyRef` 字段，其值是凭据引用名（例如环境变量名 `DEEPSEEK_API_KEY`），绝不是秘密值。每个适配器用已解析引用标注失败请求：

- `DeepSeekAdapter` 在 `request()` 抛出的所有 `LlmError` 上设置 `apiKeyRef`。
- `PiAiAdapter` 在流迭代循环中补充错误结束片段（`finish.kind === 'error'`）。

### Models 页 UI

每个提供方 profile（settings.yaml）的 `backupApiKeys` 字段保存有序的额外凭据引用列表。Models 编辑器展示主密钥字段和每个已配置备用引用的字段，并提供“添加另一个密钥”操作。每个备用字段管理自己的派生引用（`${primaryRef}_2`、`${primaryRef}_3` 等）。冷却与轮换仅存在于运行时，UI 不读取或展示冷却状态。

### 各包的变更

| 包 | 变更 |
|---|---|
| `dsh-llm` | `LlmFailure.apiKeyRef`、`LlmErrorOptions.apiKeyRef`、`normalizeLlmFailure` 透传、新增 `key-rotation.ts` |
| `llm-deepseek` | 配置 `backupApiKeys`、`apiKeyCooldownMs`；感知轮换的解析器；`agent/request-error` 监听器；适配器错误标注 |
| `llm-pi-ai` | Profile schema 中的 `backupApiKeys`、`apiKeyCooldownMs`；感知轮换的解析器；`agent/request-error` 监听器；适配器结束片段标注 |
| `ui-settings-models` | Store 读取 `backupApiKeys`；编辑器展示多密钥字段；删除流程取消页面管理的备用凭据 |

## Verification

1. **单元测试**：`KeyRotation`（标记、可用性、到期、回退）、`rotateAfterQuotaFailure`（重试或终止决定）、`pickRotationRef`（跳过或回退）。
2. **适配器测试**：`LlmError` 的 apiKeyRef 构造与标准化、DeepSeek 适配器错误标注、pi-ai 适配器结束片段标注。
3. **插件测试**：`agent/request-error` 监听器针对正确提供方的配额错误返回 `retry`，在所有密钥耗尽后返回 `terminal`。
4. **解析测试**：监听器停用密钥后，下次流调用解析备用密钥（通过 Authorization 请求头验证）。
5. **真实组合测试**：Loader 完整启动 session、agent-loop 和 llm-deepseek；一个 agent 步骤通过切换备用密钥从配额错误恢复。
6. **UI 组件测试**：添加和备用字段、移除时取消凭据、保留未改动的已配置字段、提示文字、避免派生引用冲突。

## Alternatives considered

### 适配器内部重试循环

DeepSeek 适配器已有用于过期文件 ID 重试的 `while (true)` 循环。将密钥轮换加入该循环可使机制完全自包含。但是，切换密钥属于凭据策略，适配器文档规定注册插件负责验证、分层与凭据策略。通用的 `agent/request-error` waterfall 将这些职责分开。

### 仅集成到 llm-retry

轮换可以放入已处理 `agent/request-error` waterfall 的 `llm-retry` 插件，但它不拥有提供方配置（密钥列表、冷却设置）。让它了解逐路由凭据引用会使它与每个提供方插件的 schema 耦合。逐插件监听器让提供方配置保持本地归属。

## Consequences

轮换仅存在于运行时：重启会丢失内存冷却状态，因此新轮次可能先尝试一次已耗尽的密钥再轮换。额外实现是 llm-deepseek 和 llm-pi-ai 各自的小型监听器与解析器；仅 `QUOTA` 触发轮换，限流和服务器错误仍归 `llm-retry`。Models 页提供备用密钥字段，并在删除流程中取消页面管理的备用凭据。由此，多个密钥保留在统一的提供方配置中，切换对 agent 步骤透明。
