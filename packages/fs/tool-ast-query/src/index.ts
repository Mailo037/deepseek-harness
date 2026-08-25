/**
 * Model-facing structural code search and rewrite previews over `ctx.fs`.
 * The package parses one explicitly named, observed source file with ast-grep;
 * it deliberately does not mutate files, so a reviewed preview is applied by
 * the existing policy-aware `write` or `edit` tools.
 * @module @deepseek-ai/dsh-tool-ast-query
 */

import type { Context } from '@deepseek-ai/cordis'
import { Lang, parse } from '@ast-grep/napi'
import z from '@deepseek-ai/schemastery'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { FsInfo, FsTarget } from '@deepseek-ai/dsh-fs'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ObjectValueSchemaSpec, ParameterSchemaSpec, ToolExecution } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'tool-ast-query'

/** Services required by the structural-query tools. */
export const inject = ['tools', 'fs', 'systemPrompt']

/** Default maximum AST matches retained by one call. */
export const DEFAULT_MAX_MATCHES = 100
/** Default maximum UTF-8 bytes read from one source file. */
export const DEFAULT_MAX_SOURCE_BYTES = 1_000_000
/** Default maximum characters retained from one matched node. */
export const DEFAULT_MAX_MATCH_CHARACTERS = 1_000
/** Default maximum characters in one model-visible text result. */
export const DEFAULT_MAX_RESULT_CHARACTERS = 16_000

const AST_LANGUAGES = ['typescript', 'tsx', 'javascript', 'html', 'css'] as const
type AstLanguage = typeof AST_LANGUAGES[number]

const LANGUAGE_MAP: Record<AstLanguage, Lang> = {
  typescript: Lang.TypeScript,
  tsx: Lang.Tsx,
  javascript: Lang.JavaScript,
  html: Lang.Html,
  css: Lang.Css,
}

/** Deployment-owned source and result bounds. */
export interface Config {
  /** Maximum matching syntax nodes retained by one call. Defaults to 100. */
  maxMatches?: number
  /** Maximum UTF-8 bytes read from one source file. Defaults to 1000000. */
  maxSourceBytes?: number
  /** Maximum UTF-16 characters retained from one matched syntax node. Defaults to 1000. */
  maxMatchCharacters?: number
  /** Maximum UTF-16 characters in one model-visible rendered result. Defaults to 16000. */
  maxResultCharacters?: number
}

/** Schemastery config for Loader defaults and generated configuration docs. */
export const Config: z<Config> = z.object({
  maxMatches: z.number().step(1).min(1).default(DEFAULT_MAX_MATCHES),
  maxSourceBytes: z.number().step(1).min(1).default(DEFAULT_MAX_SOURCE_BYTES),
  maxMatchCharacters: z.number().step(1).min(1).default(DEFAULT_MAX_MATCH_CHARACTERS),
  maxResultCharacters: z.number().step(1).min(1).default(DEFAULT_MAX_RESULT_CHARACTERS),
})

interface ResolvedConfig {
  readonly maxMatches: number
  readonly maxSourceBytes: number
  readonly maxMatchCharacters: number
  readonly maxResultCharacters: number
}

interface AstInput {
  readonly filePath: string
  readonly language: AstLanguage
  readonly pattern: string
}

interface AstRewriteInput extends AstInput {
  readonly rewrite: string
}

interface AstMatch {
  readonly startLine: number
  readonly startColumn: number
  readonly endLine: number
  readonly endColumn: number
  readonly kind: string
  readonly text: string
}

interface AstSearchOutput {
  readonly path: string
  readonly matches: AstMatch[]
  readonly omitted: boolean
}

interface AstRewritePreviewOutput extends AstSearchOutput {
  readonly before: string
  readonly after: string
}

const MATCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    startLine: { type: 'integer', required: true },
    startColumn: { type: 'integer', required: true },
    endLine: { type: 'integer', required: true },
    endColumn: { type: 'integer', required: true },
    kind: { type: 'string', required: true },
    text: { type: 'string', required: true },
  },
} as const satisfies ObjectValueSchemaSpec

const AST_SEARCH_PARAMETERS = {
  file_path: { type: 'string', required: true, description: 'UTF-8 source path, resolved relative to the calling session workspace.' },
  language: { type: 'string', required: true, enum: AST_LANGUAGES, description: 'Parser language for the source file.' },
  pattern: { type: 'string', required: true, description: 'ast-grep syntax pattern, such as foo($A) or function $NAME($$$) { $$$ }.' },
} as const satisfies ParameterSchemaSpec

const AST_REWRITE_PARAMETERS = {
  ...AST_SEARCH_PARAMETERS,
  rewrite: { type: 'string', required: true, description: 'Replacement text for every matched syntax node; the tool only previews it.' },
} as const satisfies ParameterSchemaSpec

const AST_SEARCH_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string', required: true },
    matches: { type: 'array', required: true, items: MATCH_SCHEMA },
    omitted: { type: 'boolean', required: true },
  },
} as const satisfies ObjectValueSchemaSpec

const AST_REWRITE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ...AST_SEARCH_OUTPUT_SCHEMA.properties,
    before: { type: 'string', required: true },
    after: { type: 'string', required: true },
  },
} as const satisfies ObjectValueSchemaSpec

/** Register structural search and rewrite-preview tools. */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  ctx.systemPrompt.section({
    name: 'tool:ast-query',
    order: 111,
    text: 'Use ast_search when a code question depends on syntax rather than text, such as a particular call expression or function form. Use ast_rewrite_preview to inspect a structural rewrite before applying the reviewed change with the ordinary write or edit tools. Both tools operate on one named source file and read it through the filesystem capability.',
  })

  ctx.tools.register(defineTool({
    name: 'ast_search',
    description: 'Find syntax-tree matches for one ast-grep pattern in one observed source file.',
    parameters: AST_SEARCH_PARAMETERS,
    output: {
      schema: AST_SEARCH_OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: formatSearchOutput(value, resolved.maxResultCharacters) }],
    },
    isConcurrencySafe: () => true,
    execute: async (args, exec) => searchFile(ctx, parseAstInput(args), exec, resolved),
    presentCall: args => presentCall('Search AST', args),
  }))

  ctx.tools.register(defineTool({
    name: 'ast_rewrite_preview',
    description: 'Preview a structural ast-grep rewrite in one observed source file without changing the file.',
    parameters: AST_REWRITE_PARAMETERS,
    output: {
      schema: AST_REWRITE_OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: formatRewriteOutput(value, resolved.maxResultCharacters) }],
    },
    isConcurrencySafe: () => true,
    execute: async (args, exec) => previewRewrite(ctx, parseAstRewriteInput(args), exec, resolved),
    presentCall: args => presentCall('Preview AST rewrite', args),
  }))
}

async function searchFile(
  ctx: Context,
  input: AstInput,
  exec: ToolExecution,
  config: ResolvedConfig,
): Promise<AstSearchOutput> {
  const source = await readSource(ctx, input.filePath, exec, config.maxSourceBytes)
  const root = parse(LANGUAGE_MAP[input.language], source.text).root()
  const matches = root.findAll(input.pattern)
  return {
    path: source.target.displayPath,
    matches: matches.slice(0, config.maxMatches).map(match => formatMatch(match, config.maxMatchCharacters)),
    omitted: matches.length > config.maxMatches,
  }
}

async function previewRewrite(
  ctx: Context,
  input: AstRewriteInput,
  exec: ToolExecution,
  config: ResolvedConfig,
): Promise<AstRewritePreviewOutput> {
  const source = await readSource(ctx, input.filePath, exec, config.maxSourceBytes)
  const root = parse(LANGUAGE_MAP[input.language], source.text).root()
  const nodes = root.findAll(input.pattern)
  const retained = nodes.slice(0, config.maxMatches)
  const after = root.commitEdits(retained.map(node => node.replace(input.rewrite)))
  return {
    path: source.target.displayPath,
    matches: retained.map(match => formatMatch(match, config.maxMatchCharacters)),
    omitted: nodes.length > config.maxMatches,
    before: source.text,
    after,
  }
}

async function readSource(
  ctx: Context,
  requestedPath: string,
  exec: ToolExecution,
  maxBytes: number,
): Promise<{ target: FsTarget; text: string }> {
  const cwd = exec.agent?.session.header.cwd
  const target = await ctx.fs.resolve(requestedPath, {
    ...cwd === undefined ? {} : { cwd },
    signal: exec.signal,
  })
  const info = await ctx.fs.stat(target, exec.signal)
  if (info === undefined) {
    ctx.emit('fs/observed', target, { kind: 'absent' }, exec)
    throw new FsError(`cannot parse "${target.displayPath}": not found`, 'FS_NOT_FOUND')
  }
  assertSourceFile(target, info, maxBytes)
  const text = await readBoundedText(ctx, target, info, exec.signal, maxBytes)
  ctx.emit('fs/observed', target, { kind: 'present', version: info.version }, exec)
  return { target, text }
}

function assertSourceFile(target: FsTarget, info: FsInfo, maxBytes: number): void {
  if (info.type !== 'file') throw new FsError(`cannot parse "${target.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE')
  if (info.size !== undefined && info.size > maxBytes) {
    throw new FsError(`cannot parse "${target.displayPath}": source exceeds ${maxBytes} bytes`, 'FS_TOO_LARGE')
  }
}

async function readBoundedText(
  ctx: Context,
  target: FsTarget,
  info: FsInfo,
  signal: AbortSignal,
  maxBytes: number,
): Promise<string> {
  if (info.size !== undefined) return ctx.fs.readText(target, signal)
  let result = ''
  let bytes = 0
  for await (const chunk of await ctx.fs.streamText(target, signal)) {
    bytes += Buffer.byteLength(chunk)
    if (bytes > maxBytes) throw new FsError(`cannot parse "${target.displayPath}": source exceeds ${maxBytes} bytes`, 'FS_TOO_LARGE')
    result += chunk
  }
  return result
}

function formatMatch(
  node: { range(): { start: { line: number; column: number }; end: { line: number; column: number } }; kind(): string | number; text(): string },
  maxCharacters: number,
): AstMatch {
  const range = node.range()
  return {
    startLine: range.start.line + 1,
    startColumn: range.start.column + 1,
    endLine: range.end.line + 1,
    endColumn: range.end.column + 1,
    kind: String(node.kind()),
    text: excerpt(node.text(), maxCharacters),
  }
}

function parseAstInput(args: unknown): AstInput {
  const record = recordOf(args)
  return {
    filePath: requiredString(record, 'file_path'),
    language: astLanguage(requiredString(record, 'language')),
    pattern: requiredString(record, 'pattern'),
  }
}

function parseAstRewriteInput(args: unknown): AstRewriteInput {
  return { ...parseAstInput(args), rewrite: requiredString(recordOf(args), 'rewrite') }
}

function recordOf(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('ast query arguments must be an object')
  return value as Record<string, unknown>
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`ast query ${key} must be a non-empty string`)
  return value
}

function astLanguage(value: string): AstLanguage {
  if ((AST_LANGUAGES as readonly string[]).includes(value)) return value as AstLanguage
  throw new TypeError(`ast query language must be one of ${AST_LANGUAGES.join(', ')}`)
}

function resolveConfig(config: Config): ResolvedConfig {
  const resolved = {
    maxMatches: config.maxMatches ?? DEFAULT_MAX_MATCHES,
    maxSourceBytes: config.maxSourceBytes ?? DEFAULT_MAX_SOURCE_BYTES,
    maxMatchCharacters: config.maxMatchCharacters ?? DEFAULT_MAX_MATCH_CHARACTERS,
    maxResultCharacters: config.maxResultCharacters ?? DEFAULT_MAX_RESULT_CHARACTERS,
  }
  for (const [key, value] of Object.entries(resolved)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`tool-ast-query: ${key} must be a positive safe integer`)
  }
  return resolved
}

function formatSearchOutput(value: AstSearchOutput, maxCharacters: number): string {
  const lines = [`AST matches in ${value.path} (${value.matches.length}${value.omitted ? '+' : ''}):`]
  if (value.matches.length === 0) lines.push('- none')
  for (const match of value.matches) {
    lines.push(`- ${match.startLine}:${match.startColumn}-${match.endLine}:${match.endColumn} | ${match.kind}`, `  ${match.text}`)
  }
  if (value.omitted) lines.push(`- More matches exist; only the first ${value.matches.length} were retained.`)
  return excerpt(lines.join('\n'), maxCharacters)
}

function formatRewriteOutput(value: AstRewritePreviewOutput, maxCharacters: number): string {
  const summary = [
    `AST rewrite preview for ${value.path}: ${value.matches.length}${value.omitted ? '+' : ''} replacement(s).`,
    'No file was changed. Review the result card, then use the policy-aware write or edit tools to apply an intended change.',
    ...value.matches.map(match => `- ${match.startLine}:${match.startColumn}-${match.endLine}:${match.endColumn} | ${match.kind}`),
    ...value.omitted ? [`- More matches exist; only the first ${value.matches.length} were included in this preview.`] : [],
  ]
  return excerpt(summary.join('\n'), maxCharacters)
}

function presentCall(action: string, args: unknown): { card: 'generic'; kind: 'read'; title: string; locations?: Array<{ path: string }> } {
  const filePath = args !== null && typeof args === 'object' && !Array.isArray(args)
    && typeof (args as Record<string, unknown>).file_path === 'string'
    ? (args as Record<string, string>).file_path
    : undefined
  return {
    card: 'generic',
    kind: 'read',
    title: filePath === undefined ? action : `${action} ${filePath}`,
    ...filePath === undefined ? {} : { locations: [{ path: filePath }] },
  }
}

function excerpt(value: string, maxCharacters: number): string {
  if (value.length <= maxCharacters) return value
  return `${value.slice(0, Math.max(0, maxCharacters - 1))}…`
}
