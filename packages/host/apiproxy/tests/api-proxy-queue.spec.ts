/**
 * Live queue-mutation paths of the host ApiProxy over a real attached Agent:
 * `session.updateQueue` reorder commits one durable window splice on the
 * queued-turn list, keeps identities stable, rejects steering/context rows
 * and vanished items, and broadcasts the authoritative `session/queue`
 * snapshot after the change.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import type { MuxFrame, RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { createApiProxy } from '@deepseek-ai/dsh-host-apiproxy'

let nextRpc = 1
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`queue-${String(nextRpc++)}`), payload }
}

function message(text: string): UserMessage {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

async function harness(): Promise<{
  ctx: Context
  inbox: Inbox
  sessionId: ReturnType<Context['sessions']['create']>['id']
}> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(AgentRegistry)
  const session = ctx.sessions.create()
  const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
  ctx.agents.register({ id: session.id, session, inbox, status: 'idle', ctx } as Agent)
  return { ctx, inbox, sessionId: session.id }
}

const api = (ctx: Context) => createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })

/** Collect mux frames until a session/queue frame led with `firstId` (skips the connect baseline). */
async function nextQueueFrame(gateway: ReturnType<typeof api>, abort: AbortController, firstId: string): Promise<Extract<MuxFrame, { type: 'session/queue' }>> {
  const stream = gateway.events.mux({ rpcId: RpcId(`queue-mux-${String(nextRpc++)}`), payload: {} }, abort.signal)
  for await (const envelope of stream) {
    const payload = envelope.payload
    if (payload.type === 'session/queue' && payload.items[0]?.id === firstId) {
      abort.abort()
      return payload
    }
  }
  throw new Error('mux stream ended without a session/queue frame')
}

describe('session.updateQueue move', () => {
  it('reorders the queued-turn list as one splice and broadcasts the snapshot', async () => {
    const { ctx, inbox, sessionId } = await harness()
    const [a, b, c] = [message('a'), message('b'), message('c')]
    inbox.append('next-turn', a)
    inbox.append('next-turn', b)
    inbox.append('next-turn', c)
    const gateway = api(ctx)
    await new Promise(resolve => setTimeout(resolve, 0))
    const abort = new AbortController()
    const frame = nextQueueFrame(gateway, abort, c.id)

    const response = await gateway.sessions.updateQueue(request({
      sessionId,
      itemId: c.id,
      action: { kind: 'move', toIndex: 0 },
    }))
    expect(response.result).toEqual({ ok: true, value: { accepted: true } })
    expect(inbox.nextTurn.map(item => item.content[0])).toEqual([
      { type: 'text', text: 'c' },
      { type: 'text', text: 'a' },
      { type: 'text', text: 'b' },
    ])
    // Identities survive the reorder.
    expect(inbox.nextTurn.map(item => item.id)).toEqual([c.id, a.id, b.id])

    const pushed = await frame
    expect(pushed.sessionId).toBe(sessionId)
    expect(pushed.items.map(item => item.id)).toEqual([c.id, a.id, b.id])
    expect(pushed.items.every(item => item.placement === 'queued')).toBe(true)
  })

  it('clamps an out-of-range index into the current list', async () => {
    const { ctx, inbox, sessionId } = await harness()
    const [a, b] = [message('a'), message('b')]
    inbox.append('next-turn', a)
    inbox.append('next-turn', b)
    const response = await api(ctx).sessions.updateQueue(request({
      sessionId,
      itemId: a.id,
      action: { kind: 'move', toIndex: 9 },
    }))
    expect(response.result.ok).toBe(true)
    expect(inbox.nextTurn.map(item => item.content[0])).toEqual([
      { type: 'text', text: 'b' },
      { type: 'text', text: 'a' },
    ])
  })

  it('rejects moves of steering rows and vanished items', async () => {
    const { ctx, inbox, sessionId } = await harness()
    const steer = message('steer')
    inbox.append('next-step', steer)
    const gateway = api(ctx)

    const steeringRow = await gateway.sessions.updateQueue(request({
      sessionId,
      itemId: steer.id,
      action: { kind: 'move', toIndex: 0 },
    }))
    expect(steeringRow.result.ok).toBe(false)
    if (!steeringRow.result.ok) expect(steeringRow.result.error.code).toBe('queue-item-not-found')

    const missing = await gateway.sessions.updateQueue(request({
      sessionId,
      itemId: createUserMessage({ content: [{ type: 'text', text: 'x' }], source: { kind: 'user' } }).id,
      action: { kind: 'move', toIndex: 0 },
    }))
    expect(missing.result.ok).toBe(false)
    if (!missing.result.ok) expect(missing.result.error.code).toBe('queue-item-not-found')
    expect(inbox.nextStep).toEqual([steer])
  })
})
