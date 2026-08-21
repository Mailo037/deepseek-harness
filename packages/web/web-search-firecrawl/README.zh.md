# @deepseek-ai/dsh-web-search-firecrawl

[English](README.md) | 中文

由 [Firecrawl](https://firecrawl.dev) 支持的 `WebSearchProvider`，用于 harness [web 能力 seam](../web/README.md)（`ctx.web`）。它调用 Firecrawl 的 `POST /v1/search` 端点（raw 结果模式），把扁平 `data[]` 映射为 seam 规范化的 `WebSearchResult`。

这是一个**实现**包：它向 `ctx.web` 注册提供方，不拥有 `ctx.web` 键，也不注册面向模型的工具（后者属于 `@deepseek-ai/dsh-tool-web`）。与 `@deepseek-ai/dsh-web-search-deepseek` 一样，它是函数／命名空间插件（`inject: ['web']`），负责注册后端，而非默认导出服务。

## 配置

| 配置键 | 默认值 | 含义 |
|---|---|---|
| `apiKey` | `$FIRECRAWL_API_KEY` | Firecrawl API 密钥（字面值，或通过凭据域解析）。为空或缺失时提供方不可用。 |
| `apiKeyEnv` | `FIRECRAWL_API_KEY` | 每次搜索时解析的凭据引用。 |
| `baseURL` | `https://api.firecrawl.dev` | 端点基址；追加 `/v1/search`。无法解析时提供方不可用。 |
| `maxResults` | （未设置） | 请求不含 `maxResults` 时使用的默认结果数。未设置时不发送默认值。必须是正整数。 |

```yaml
- id: web-search-firecrawl
  name: '@deepseek-ai/dsh-web-search-firecrawl'
  config:
    apiKey: !!js process.env.FIRECRAWL_API_KEY
```

提供方拥有 `web-search-firecrawl` 设置分区（端点和密钥引用），因此 Web 设置卡片和凭据域可以像管理 DeepSeek 提供方一样管理它。

## 映射

Firecrawl 返回扁平 `data[]`，不返回生成答案，因此省略 `content`。每项结果映射为 `WebSearchSource`：`url` ← `url`、`title` ← `title`、`snippet` ← `description`。没有 URL 的条目不可引用，会被丢弃。请求的 `maxResults` 优先于已配置的默认 `maxResults`，并作为 Firecrawl `limit` 发送，以优化成本和延迟；最终上限由 seam 强制执行。提供方失败（HTTP 错误、网络失败、响应体无法解析或结构不符）以 `WebError` `WEB_PROVIDER_ERROR` 呈现；缺少密钥以 `WEB_PROVIDER_CREDENTIAL_MISSING` 呈现；中止请求以 `WEB_ABORTED` 呈现。HTTP 重定向会在访问 `Location` 指向的目标之前被拒绝，并以 `WEB_PROVIDER_ERROR` 呈现。

## 模型体验

通过 [`dsh-tool-web`](../tool-web/README.md) 间接影响；该工具保留此提供方经 `maxResults` 限制的 URL、标题与描述，或将确切的错误消息 `Firecrawl search aborted`、`Firecrawl search request failed: <error>` 和 `Firecrawl returned an unprocessable response body: <error>` 置于消费方的错误包装层内；生成答案与提供方私有字段不进入上下文。

#### KV Cache 影响

不会直接导致 KV Cache 失效；请求前缀变更由上述消费方负责。

## 已知限制与暂缓事项

- **仅使用 raw 结果模式**：不请求 Firecrawl 的 markdown/搜索结果模式内容；有 `description` 时映射为 `snippet`，没有描述的结果仅含 URL。
- **只公开 `limit`**：Firecrawl 的其他控制项（语言、国家、时效过滤、scrape 选项）等待提供方无关的 Service Definition 字段（见 [seam Agent Note](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md)）。
- **按错误形状分类中止**：只有 `DOMException` 且名为 `AbortError` 时才映射为 `WEB_ABORTED`；携带自定义原因的中止（例如 `dsh-timeout` 的 `TimeoutReason`）会呈现为 `WEB_PROVIDER_ERROR`。