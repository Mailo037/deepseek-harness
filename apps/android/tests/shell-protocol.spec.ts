import { describe, expect, it } from 'vitest'
import { embeddedConnectionStateOf, openSessionMessageOf } from '../src/ShellProtocol.ts'

describe('embeddedConnectionStateOf', () => {
  it('accepts the two version-one connection states', () => {
    expect(embeddedConnectionStateOf({
      type: 'dsh/client-connection-state', version: 1, state: 'connected',
    })).toBe('connected')
    expect(embeddedConnectionStateOf({
      type: 'dsh/client-connection-state', version: 1, state: 'reconnecting',
    })).toBe('reconnecting')
  })

  it('rejects unrelated, future, and malformed messages', () => {
    expect(embeddedConnectionStateOf(null)).toBeNull()
    expect(embeddedConnectionStateOf({
      type: 'dsh/client-connection-state', version: 2, state: 'connected',
    })).toBeNull()
    expect(embeddedConnectionStateOf({
      type: 'dsh/client-shell-context', version: 1, state: 'connected',
    })).toBeNull()
    expect(embeddedConnectionStateOf({
      type: 'dsh/client-connection-state', version: 1, state: 'offline',
    })).toBeNull()
  })

  it('formats open-session message with version 1 and target session', () => {
    expect(openSessionMessageOf('session-123')).toEqual({
      type: 'dsh/open-session',
      version: 1,
      sessionId: 'session-123',
    })
  })
})
