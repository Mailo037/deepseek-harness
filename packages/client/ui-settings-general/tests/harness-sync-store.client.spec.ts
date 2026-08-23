import { describe, expect, it, vi } from 'vitest'
import type { SessionId, WorkspaceId } from '@deepseek-ai/dsh-api-remotes/client'
import {
  OFFICIAL_HARNESS_REPOSITORY,
  UNOFFICIAL_HARNESS_REPOSITORY,
  HarnessSyncStore,
  harnessIntegrationPrompt,
} from '../src/client/harness-sync-store.ts'

const sessionId = 'review-session' as SessionId
const workspaceId = 'harness-workspace' as WorkspaceId

function directory() {
  return {
    current: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'max' },
    routable: true,
    groups: [
      {
        id: 'deepseek-official',
        name: 'DeepSeek',
        models: [
          {
            id: 'deepseek-v4-pro',
            name: 'DeepSeek V4 Pro',
            reasoning: { efforts: [], defaultEffort: 'max' },
          },
          { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
        ],
      },
    ],
    failures: [],
  }
}

function bench(overrides?: {
  models?: ReturnType<typeof vi.fn>
  selectModel?: ReturnType<typeof vi.fn>
  prompt?: ReturnType<typeof vi.fn>
  binding?: ReturnType<typeof vi.fn>
}) {
  const models = overrides?.models ?? vi.fn(() => Promise.resolve({
    rpcId: 'models' as never,
    result: { ok: true as const, value: directory() },
  }))
  const selectModel = overrides?.selectModel ?? vi.fn((request: { provider: string; model: string }) => Promise.resolve({
    rpcId: 'select-model' as never,
    result: {
      ok: true as const,
      value: { selected: { provider: request.provider, model: request.model } },
    },
  }))
  const prompt = overrides?.prompt ?? vi.fn(() => Promise.resolve({
    ok: true as const,
    value: { accepted: true as const },
  }))
  const binding = overrides?.binding ?? vi.fn(() => ({ session: { prompt } }))
  const open = vi.fn()
  const connectWorkspace = vi.fn(() => Promise.resolve(sessionId))
  const controller = new HarnessSyncStore(
    { sessions: { models, selectModel } } as never,
    { binding, open } as never,
    { connectWorkspace } as never,
  )
  return { controller, models, selectModel, prompt, binding, open, connectWorkspace }
}

describe('HarnessSyncStore', () => {
  it('prepares the selected Workspace and preserves the current model as the default', async () => {
    const b = bench()
    await b.controller.prepare(workspaceId, 'C:\\repo')

    expect(b.connectWorkspace).toHaveBeenCalledWith(workspaceId)
    expect(b.models).toHaveBeenCalledWith({ sessionId })
    expect(b.prompt).not.toHaveBeenCalled()
    expect(b.controller.store.getSnapshot()).toMatchObject({
      phase: 'ready',
      targetPath: 'C:\\repo',
      sessionId,
      selectedModelId: 'model-0',
    })
    expect(b.controller.store.getSnapshot().models.map(model => model.label)).toEqual([
      'DeepSeek V4 Pro', 'DeepSeek V4 Flash',
    ])
  })

  it('starts the review on the current model without a redundant selection', async () => {
    const b = bench()
    await b.controller.prepare(workspaceId, 'C:\\repo')
    await expect(b.controller.start()).resolves.toBe(true)

    expect(b.selectModel).not.toHaveBeenCalled()
    expect(b.prompt).toHaveBeenCalledOnce()
    const [content, mode] = b.prompt.mock.calls[0]!
    expect(content[0].text).toContain(UNOFFICIAL_HARNESS_REPOSITORY)
    expect(content[0].text).toContain('wait for my explicit approval before editing tracked files')
    expect(mode).toBe('queue')
    expect(b.open).toHaveBeenCalledWith(sessionId)
  })

  it('selects a different advertised model before sending the review', async () => {
    const b = bench()
    await b.controller.prepare(workspaceId, '/repo')
    b.controller.selectModel('model-1')
    await expect(b.controller.start()).resolves.toBe(true)

    expect(b.selectModel).toHaveBeenCalledWith({
      sessionId,
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
    })
    expect(b.prompt).toHaveBeenCalledOnce()
  })

  it('switches to the official source while keeping the unofficial source as default', async () => {
    const b = bench()
    expect(b.controller.store.getSnapshot().source).toBe('unofficial')
    b.controller.selectSource('official')
    await b.controller.prepare(workspaceId, '/repo')
    await b.controller.start()

    const [content] = b.prompt.mock.calls[0]!
    expect(content[0].text).toContain(OFFICIAL_HARNESS_REPOSITORY)
    expect(content[0].text).toContain('official DeepSeek Harness upstream')
  })

  it('keeps an unadvertised but routable current model selectable', async () => {
    const models = vi.fn(() => Promise.resolve({
      rpcId: 'models' as never,
      result: {
        ok: true as const,
        value: { ...directory(), groups: [] },
      },
    }))
    const b = bench({ models })
    await b.controller.prepare(workspaceId, '/repo')

    expect(b.controller.store.getSnapshot().models).toMatchObject([
      { id: 'current', group: 'deepseek-official', label: 'deepseek-v4-pro' },
    ])
    await expect(b.controller.start()).resolves.toBe(true)
    expect(b.selectModel).not.toHaveBeenCalled()
  })

  it('reports preparation and prompt failures without navigating', async () => {
    const unroutable = vi.fn(() => Promise.resolve({
      rpcId: 'models' as never,
      result: { ok: true as const, value: { ...directory(), routable: false } },
    }))
    const failedPrepare = bench({ models: unroutable })
    await failedPrepare.controller.prepare(workspaceId, '/repo')
    expect(failedPrepare.controller.store.getSnapshot()).toMatchObject({
      phase: 'error', error: 'The current model provider is unavailable.',
    })

    const prompt = vi.fn(() => Promise.resolve({
      ok: false as const,
      error: { code: 'internal' as const, message: 'prompt refused', details: {} },
    }))
    const failedStart = bench({ prompt })
    await failedStart.controller.prepare(workspaceId, '/repo')
    await expect(failedStart.controller.start()).resolves.toBe(false)
    expect(failedStart.controller.store.getSnapshot()).toMatchObject({ phase: 'ready', error: 'prompt refused' })
    expect(failedStart.open).not.toHaveBeenCalled()
  })

  it('ignores stale model ids and refuses to start before preparation', async () => {
    const b = bench()
    b.controller.selectModel('missing')
    await expect(b.controller.start()).resolves.toBe(false)
    expect(b.models).not.toHaveBeenCalled()
    expect(b.prompt).not.toHaveBeenCalled()
  })
})

describe('harnessIntegrationPrompt', () => {
  it('pins comparison evidence, customization preservation, approval, isolation, and external-action limits', () => {
    const prompt = harnessIntegrationPrompt('/repo', 'unofficial')
    expect(prompt).toContain('local version, selected-source version, merge base, ahead/behind counts')
    expect(prompt).toContain('Treat every pre-existing tracked or untracked change')
    expect(prompt).toContain('maintained fork/product changes, and local user customizations')
    expect(prompt).toContain('wait for my explicit approval')
    expect(prompt).toContain('isolated harness-sync/* branch and worktree')
    expect(prompt).toContain('Do not push, merge, release, deploy, or restart the app')
  })
})
