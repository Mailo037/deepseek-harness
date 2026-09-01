# @deepseek-ai/dsh-tool-ast-query

English | [中文](README.zh.md)

Structural code-query consumer over `ctx.fs`. It registers `ast_search` for ast-grep pattern matches and `ast_rewrite_preview` for a non-mutating before/after preview. Both tools read one explicitly named, observed UTF-8 source file and support TypeScript, TSX, JavaScript, HTML, and CSS. Reviewed changes remain owned by the ordinary policy-aware write or edit tools.

The deployment config bounds source bytes, retained matches, per-match text, and the final model-visible result. The parser rejects unsupported languages and malformed patterns. Filesystem errors retain their stable codes, and rewrite preview never writes a file.

## Model Experience

### System prompt

#### What the model sees

Every request in the plugin scope receives the fixed guidance below.

##### Structural query guidance

```markdown
Use ast_search when a code question depends on syntax rather than text, such as a particular call expression or function form. Use ast_rewrite_preview to inspect a structural rewrite before applying the reviewed change with the ordinary write or edit tools. Both tools operate on one named source file and read it through the filesystem capability.
```

#### Token effect

Fixed guidance cost while the plugin is active.

#### KV Cache effect

Prefix-stable while the plugin scope and guidance text remain unchanged.

### Tool schemas

#### What the model sees

The generated [`ast_search` and `ast_rewrite_preview` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-ast-query) expose one file path, parser language, ast-grep pattern, and for previews a replacement string. Results contain bounded source locations and matched text; previews additionally contain the complete before and after text within configured limits.

#### Token effect

Fixed schema cost whenever the tools are visible; call results vary with the source and configured caps.

#### KV Cache effect

Prefix-stable while tool visibility and definitions remain unchanged; tool results extend later request context.

## Known Limitations and Deferred Work

- **One file per call** — workspace-wide structural discovery requires the model to first identify candidate files with ordinary path or text search.
- **Preview only** — structural replacement is deliberately non-mutating; the model must review and apply the result separately.
- **Fixed language set** — additional ast-grep languages require an explicit package change.
