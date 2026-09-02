import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ToolAstQuery from '@deepseek-ai/dsh-tool-ast-query'

const contexts: Context[] = []
const directories: string[] = []
let sequence = 0

afterEach(async () => {
  for (const context of contexts.splice(0)) await context.fiber.dispose()
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

async function mount(config: ToolAstQuery.Config = {}): Promise<{ ctx: Context; cwd: string }> {
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-tool-ast-query-'))
  directories.push(cwd)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LocalFileSystem, { cwd })
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(ToolAstQuery, config)
  return { ctx, cwd }
}

function call(ctx: Context, name: 'ast_search' | 'ast_rewrite_preview', arguments_: unknown, cwd: string) {
  return ctx.tools.execute({
    name,
    arguments: arguments_,
    callId: `call-${++sequence}` as never,
    signal: new AbortController().signal,
    agent: { session: { header: { cwd } } } as never,
  })
}

describe('tool-ast-query', () => {
  it('registers structural search and a non-mutating rewrite preview with stable guidance', async () => {
    const { ctx } = await mount()

    expect(ctx.tools.schemas().map(schema => schema.name)).toEqual(['ast_search', 'ast_rewrite_preview'])
    expect((await ctx.systemPrompt.assemble()).sections.find(section => section.name === 'tool:ast-query')?.text)
      .toContain('ast_rewrite_preview')
    const input = { file_path: 'example.ts', language: 'typescript', pattern: 'target(null)' }
    expect(ctx.tools.get('ast_search')?.isConcurrencySafe?.(input)).toBe(true)
    expect(ctx.tools.get('ast_rewrite_preview')?.isConcurrencySafe?.({ ...input, rewrite: 'target(undefined)' })).toBe(true)
  })

  it('finds syntax nodes rather than plain-text substrings and resolves paths from the agent workspace', async () => {
    const { ctx, cwd } = await mount()
    await writeFile(join(cwd, 'example.ts'), [
      'const hidden = "target(null)"',
      'const actual = target(null)',
      'const other = target("value")',
      '',
    ].join('\n'))

    const result = await call(ctx, 'ast_search', {
      file_path: 'example.ts',
      language: 'typescript',
      pattern: 'target(null)',
    }, cwd)

    expect(result.isError).toBe(false)
    expect(result.value).toMatchObject({
      path: join(cwd, 'example.ts'),
      omitted: false,
      matches: [{ startLine: 2, startColumn: 16, kind: 'call_expression', text: 'target(null)' }],
    })
    expect(result.content[0]).toHaveProperty('type', 'text')
    expect(result.content[0]).toHaveProperty('text', expect.stringContaining('2:16'))
  })

  it('returns a structural rewrite preview without changing the source file', async () => {
    const { ctx, cwd } = await mount()
    const path = join(cwd, 'example.ts')
    const before = 'const actual = target(null)\n'
    await writeFile(path, before)

    const result = await call(ctx, 'ast_rewrite_preview', {
      file_path: 'example.ts',
      language: 'typescript',
      pattern: 'target(null)',
      rewrite: 'target(undefined)',
    }, cwd)

    expect(result.isError).toBe(false)
    expect(result.value).toMatchObject({ before, after: 'const actual = target(undefined)\n' })
    expect(await readFile(path, 'utf8')).toBe(before)
    expect(result.content[0]).toHaveProperty('type', 'text')
    expect(result.content[0]).toHaveProperty('text', expect.stringContaining('No file was changed.'))
  })

  it('fails before parsing a source file above the configured byte cap', async () => {
    const { ctx, cwd } = await mount({ maxSourceBytes: 4 })
    await writeFile(join(cwd, 'large.ts'), 'const value = 1\n')

    const result = await call(ctx, 'ast_search', {
      file_path: 'large.ts',
      language: 'typescript',
      pattern: 'const $A = $B',
    }, cwd)

    expect(result).toMatchObject({ isError: true, error: { info: { code: 'FS_TOO_LARGE' } } })
  })
})
