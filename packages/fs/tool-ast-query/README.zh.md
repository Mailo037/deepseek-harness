# @deepseek-ai/dsh-tool-ast-query

[English](README.md) | 中文

基于 `ctx.fs` 的结构化代码查询消费方。它注册 `ast_search` 以查找 ast-grep 模式匹配，并注册 `ast_rewrite_preview` 以生成不修改文件的前后预览。两个工具都读取一个明确命名、已观测的 UTF-8 源文件，支持 TypeScript、TSX、JavaScript、HTML 与 CSS。经审阅的变更仍由普通、受策略保护的 write 或 edit 工具负责。

部署配置限制源文件字节数、保留匹配数、单个匹配文本和最终模型可见结果。解析器拒绝不支持的语言和无效模式。文件系统错误保留稳定 code，重写预览绝不写入文件。

## 模型体验

### 系统提示词

#### 模型看到什么

插件作用域内的每个请求都会获得以下固定指引。

##### Structural query guidance

```markdown
Use ast_search when a code question depends on syntax rather than text, such as a particular call expression or function form. Use ast_rewrite_preview to inspect a structural rewrite before applying the reviewed change with the ordinary write or edit tools. Both tools operate on one named source file and read it through the filesystem capability.
```

#### Token 影响

插件启用期间存在固定指引成本。

#### KV Cache 影响

插件作用域和指引文本不变时前缀稳定。

### 工具 schema

#### 模型看到什么

生成的 [`ast_search` 与 `ast_rewrite_preview` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-ast-query) 暴露一个文件路径、解析语言、ast-grep 模式，并为预览额外暴露替换字符串。结果包含受限的源码位置和匹配文本；预览还包含配置限制内的完整前后文本。

#### Token 影响

工具可见时 schema 成本固定；调用结果随源文件和配置上限变化。

#### KV Cache 影响

工具可见性和定义不变时前缀稳定；工具结果会扩展后续请求上下文。

## 已知限制与暂缓事项

- **每次调用一个文件**——工作区范围的结构发现需要模型先用普通路径或文本搜索确定候选文件。
- **仅预览**——结构替换有意不修改文件；模型必须另行审阅并应用结果。
- **固定语言集合**——增加其他 ast-grep 语言需要明确修改本包。
