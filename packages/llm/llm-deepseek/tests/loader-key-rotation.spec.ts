/**
 * Real-composition key-rotation test: the llm-deepseek provider, the agent
 * loop, and the credential seam boot through the Loader, and a single agent
 * step recovers from a quota-classified error by switching to the backup key.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as LlmDeepSeek from '@deepseek-ai/dsh-llm-deepseek'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  await closeMockServers()
  vi.unstubAllEnvs()
})

async function loadComposition(baseURL: string): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-llm-key-rotation-'))
  vi.stubEnv('DSH_HOME', root)
  vi.stubEnv('DEEPSEEK_API_KEY', 'primary-key')
  vi.stubEnv('BACKUP_KEY', 'backup-key')

  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    '- id: llm',
    "  name: 'test-llm-service'",
    '- id: session',
    "  name: '@deepseek-ai/dsh-session'",
    '- id: system-prompt',
    "  name: '@deepseek-ai/dsh-system-prompt'",
    '- id: tools',
    "  name: '@deepseek-ai/dsh-tools'",
    '- id: agent',
    "  name: '@deepseek-ai/dsh-agent'",
    '- id: agent-loop',
    "  name: '@deepseek-ai/dsh-agent-loop'",
    '  config:',
    '    agents: []',
    '- id: llm-deepseek',
    "  name: '@deepseek-ai/dsh-llm-deepseek'",
    '  config:',
    `    baseURL: ${JSON.stringify(baseURL)}`,
    '    backupApiKeys: [BACKUP_KEY]',
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['test-llm-service', LlmRuntime],
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-agent-loop', AgentLoop],
    ['@deepseek-ai/dsh-llm-deepseek', LlmDeepSeek],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await ctx.loader.await()
  return ctx
}

describe('llm-deepseek key rotation composition', () => {
  it('switches to the backup key after a quota-classified failure in one agent step', async () => {
    const server = await mockServer([
      { kind: 'http-error', status: 402, body: JSON.stringify({ error: { message: 'usage limit reached' } }) },
      { kind: 'sse', events: textEvents },
    ])
    const ctx = await loadComposition(server.url)

    const agent = ctx.agentLoop.create(SessionId('key-rotation-composition'), {
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
    })
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'hello' }],
      source: { kind: 'user' },
    }))
    await agent.whenIdle()

    // The step succeeded after one retry with the backup key.
    const messages = agent.session.deriveMessages()
    expect(messages).toHaveLength(2) // user + assistant
    expect(messages[1]?.role).toBe('assistant')
    // The first request failed (usage limit) and the second succeeded.
    expect(server.requests).toHaveLength(2)
    expect(server.headers[0]?.authorization).toBe('Bearer primary-key')
    expect(server.headers[1]?.authorization).toBe('Bearer backup-key')
  })
})
