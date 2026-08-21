// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import {
  EMPTY_CHAT_SNAPSHOT, EMPTY_CONVERSATION_VIEWS,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ConversationSnapshot, QueuedMessage, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { QueueItemId } from '../src/client/contract/queue.ts'
import { zh } from '../src/client/locales.ts'
import { QueueDock, type QueueDockInjected, type QueueDockProps } from '../src/client/queue/QueueDock.tsx'

const SID = 's1' as SessionId
function row(id: string): QueuedMessage {
  return {
    id: id as QueueItemId, messageId: `m-${id}` as never, placement: 'queued',
    content: [{ type: 'text', text: id }], preview: id, text: id,
  }
}
describe('debug', () => {
  it('prints child html', () => {
    const snap = {
      sessionId: SID, views: EMPTY_CONVERSATION_VIEWS, chat: EMPTY_CHAT_SNAPSHOT,
      nodes: [], turnTimings: new Map(), turnEnds: new Map(), partial: null, runningCalls: [],
      pending: [], queue: [row('a'), row('b')], running: true, composerPhase: 'active' as const, removed: false,
      openState: 'open' as const, openError: null, hasMore: false, loadingOlder: false, promptError: null,
      blank: false, subagent: {
        address: { parentSessionId: 'p' as SessionId, childSessionId: SID, mode: 'continuable' as const },
        parentAvailable: true,
      }, lastAgentError: null,
    }
    let snapshot = snap
    const useSession: SnapshotSelectorHook<ConversationSnapshot> = selector =>
      // oxlint-disable-next-line typescript/no-unnecessary-condition
      useSyncExternalStore(() => () => {}, () => selector(snapshot))
    const props = {
      sessionId: SID,
      t: makeTranslate(zh, commonZh),
      useSessions: (() => undefined) as never,
      useWorkspaces: (() => undefined) as never,
      useProjection: (() => undefined) as never,
      useInput: (() => undefined) as never,
      inputActions: {} as never,
      session: snap,
      input: { draft: '', imageIds: [], draftRev: 0, phase: 'plain' as const, occurrences: [], queue: [] },
      updateQueue: () => Promise.resolve(),
      notify: () => {},
      beginQueueEdit: () => true,
      cancelQueueEdit: () => {},
    } satisfies Omit<QueueDockProps & QueueDockInjected, 'useSession'> as never
    const view = render(<QueueDock {...props} useSession={useSession} />)
    console.log('SUBAGENT_MUTABLE_READS:', view.container.querySelectorAll('[aria-label="删除排队消息"]').length)
    console.log(view.container.innerHTML.slice(0, 600))
  })
})
