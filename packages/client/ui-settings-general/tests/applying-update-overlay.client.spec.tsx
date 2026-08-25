// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import {
  ApplyingUpdateOverlay, githubIssueDraftUrl, parseRunnerProgress, updateRefreshUrl,
  type ApplyingUpdateOverlayProps,
} from '../src/client/ApplyingUpdateOverlay.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function connection(state: 'connected' | 'reconnecting') {
  return {
    state: {
      getSnapshot: () => state,
      subscribe: () => () => {},
    },
  } as never
}

describe('ApplyingUpdateOverlay', () => {
  it('renders bounded runner build logs over the initiating tab', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        updateId: 'update-1', phase: 'building', status: 'Building the updated app…',
        logs: [
          { seq: 1, stream: 'system', text: '$ pnpm run build' },
          { seq: 2, stream: 'stdout', text: 'Build complete' },
        ],
        logLimit: 80,
        issueUrl: 'https://github.com/deepseek-ai/deepseek-harness/issues/new',
      }),
    })))
    const snapshot = createSnapshotStore({ phase: 'restarting' as const, check: null, error: null })
    render(<ApplyingUpdateOverlay {...({} as ApplyingUpdateOverlayProps)}
      connection={connection('connected')}
      snapshot={snapshot}
      t={(key) => {
        switch (key) {
          case 'update.title': return 'Applying update'
          case 'update.building': return 'Building the updated app…'
          case 'update.logs': return 'Update log'
          case 'update.logs.limit': return 'Showing up to the latest 80 lines'
          default: return key
        }
      }}
    />)

    expect(screen.getByText('Applying update')).toBeTruthy()
    await waitFor(() => { expect(screen.getByRole('log')).toBeTruthy() })
    expect(screen.getByText('$ pnpm run build')).toBeTruthy()
    expect(screen.getByText('Build complete')).toBeTruthy()
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(screen.getByText('Building the updated app…')).toBeTruthy()
  })

  it('rejects malformed status and creates a cache-busting refresh URL', () => {
    expect(parseRunnerProgress({ updateId: 'u', phase: 'building', progress: 101, status: 'x' })).toBeNull()
    expect(updateRefreshUrl('http://127.0.0.1:3080/chat?id=1#end', 'update-2'))
      .toBe('http://127.0.0.1:3080/chat?id=1&__dsh_update=update-2#end')
  })

  it('renders a GitHub-marked issue link when the update fails', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        updateId: 'update-4', phase: 'failed', status: 'Update failed', error: 'build failed',
        logs: [], logLimit: 80,
        issueUrl: 'https://github.com/Mailo037/deepseek-harness/issues/new',
      }),
    })))
    const snapshot = createSnapshotStore({ phase: 'restarting' as const, check: null, error: null })
    render(<ApplyingUpdateOverlay {...({} as ApplyingUpdateOverlayProps)}
      connection={connection('connected')}
      snapshot={snapshot}
      t={(key) => {
        switch (key) {
          case 'update.failedTitle': return 'Update failed'
          case 'update.issue': return 'Create GitHub issue draft'
          default: return key
        }
      }}
    />)

    const issueButton = await screen.findByRole('link', { name: 'Create GitHub issue draft' })
    expect(issueButton.getAttribute('target')).toBe('_blank')
    expect(issueButton.getAttribute('rel')).toBe('noreferrer')
    const icon = issueButton.querySelector('svg')
    expect(icon).not.toBeNull()
    expect(icon!.innerHTML).toContain('currentColor')
  })

  it('creates a reviewable issue draft with secrets and home paths redacted', () => {
    const url = githubIssueDraftUrl({
      updateId: 'update-3',
      phase: 'failed',
      status: 'Update failed',
      error: 'token=super-secret',
      logs: [{ seq: 1, stream: 'stderr', text: 'C:\\Users\\alice api_key=abc123 build failed' }],
      logLimit: 80,
      issueUrl: 'https://github.com/Mailo037/deepseek-harness/issues/new',
    })
    expect(url).not.toBeNull()
    const parsed = new URL(url as string)
    expect(parsed.pathname).toBe('/Mailo037/deepseek-harness/issues/new')
    expect(parsed.searchParams.get('body')).toContain('C:\\Users\\<user>')
    expect(parsed.searchParams.get('body')).not.toContain('super-secret')
    expect(parsed.searchParams.get('body')).not.toContain('abc123')
  })
})
