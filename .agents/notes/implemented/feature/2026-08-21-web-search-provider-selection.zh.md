# Agent Note: 网页搜索卡片选择应答提供方（DeepSeek/Exa/Perplexity/Firecrawl）

Status: implemented

[English](2026-08-21-web-search-provider-selection.md) | 中文

## 问题

web 能力 seam（`ctx.web`）已经会自动选择搜索提供方，但产品只随附了一个实现（`web-search-deepseek`），网页搜索卡片也硬绑定到它：无法用 Exa、Firecrawl 等其他提供方应答搜索，应用内也没有切换后端的入口。

## 决策

seam 的选择变为可变且由用户拥有。`WebRuntime` 现在暴露 `setSearchProvider`/`setFetchProvider`，并安装自己的设置命名空间 `web-search`（schema 为 `WebRuntimeConfig`），以组合条目及环境变量覆盖作为 `base` 层。持久化的 `web-search.searchProvider` 值在提交后即时重新固定选择——无需重新注册提供方、无闪烁，且 seam 的每次搜索解析规则（配置的 id 优先，否则自动选择，否则 `WEB_PROVIDER_*` 分类）保持不变。卡片绑定该命名空间的第二个 scope，并渲染提供方下拉框。

三个提供方包现在使用 DeepSeek 提供方建立的同一套设置＋凭据语言。`web-search-exa` 和 `web-search-perplexity` 从“注册时读环境变量”重构为 thunk 模式：各自安装设置命名空间，每次搜索通过凭据域（`EXA_API_KEY`/`PERPLEXITY_API_KEY`）解析密钥，环境变量作为回退；构造函数同时接受 thunk 或普通配置对象（兼容）。新增 `web-search-firecrawl` 包，按同一模式注册 Firecrawl 提供方（`firecrawl`，`POST /v1/search`，raw 结果模式；`description` → `snippet`，无 URL 条目丢弃）。基础 bundle 挂载全部四个提供方，默认仍为 `searchProvider: deepseek-official`。

卡片的密钥控件按提供方寻址：它写入所选提供方的凭据引用（DeepSeek 的 `apiKeyEnv` 在 DeepSeek 下仍优先），提示文案标注当前寻址的引用名。

## 备选方案

**由独立的 `web-search-select` 插件拥有该分区。** 已拒绝：seam 本就拥有自己的选择配置和环境变量覆盖；分区放在旁边可避免第二套需要文档化的“优先级链”。

**保持 Exa/Perplexity 仅读环境变量，并按提供方禁用密钥字段。** 已拒绝：卡片写入的凭据所选提供方从不读取，会形成静默的配置错误。

**Exa/Perplexity 完整 thunk 重构且无兼容路径。** 已拒绝：改为联合构造函数，既有直接构造调用点（测试、e2e）继续可用，插件路径则按搜索投影分区。

## 后果

网页搜索卡片现在可以选择应答提供方并寻址正确的密钥。从下一次请求起，搜索使用已存储的提供方；没有密钥的提供方以 `WEB_PROVIDER_CREDENTIAL_MISSING` 失败，而不是被静默判定为不可用，与 DeepSeek 提供方的注册语义一致（可用性基于配置形状，密钥是每次搜索的关切）。`web-search-deepseek` 仍为组合默认值，既有部署行为不变。

## 测试

新增 seam 测试覆盖 `setSearchProvider` 的运行时重新固定、`web-search` 设置分区（存储的选择无需重新注册即生效、设置提供方卸载时回退组合层、卸载时释放命名空间）。Firecrawl 有映射、可用性、搜索、注册、设置分区测试，以及无 `$FIRECRAWL_API_KEY` 时自我跳过的真实 API e2e。Exa/Perplexity 套件已按凭据语义更新。卡片测试覆盖提供方下拉框的选项与暂存、按提供方变化的密钥提示，以及选择分区的保存。完整仓库构建（`pnpm run build`）通过。
