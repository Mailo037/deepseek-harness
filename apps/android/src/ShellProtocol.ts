/** Connection states the embedded web GUI may report to its Android parent. */
export type EmbeddedConnectionState = 'connected' | 'reconnecting'

/**
 * Read one versioned connection-state announcement from the embedded GUI.
 * @param value - Untrusted `message` event payload.
 * @returns The announced state, or null when the payload is not this protocol.
 */
export function embeddedConnectionStateOf(value: unknown): EmbeddedConnectionState | null {
  if (typeof value !== 'object' || value === null) return null
  const message = value as Record<string, unknown>
  if (message.type !== 'dsh/client-connection-state' || message.version !== 1) return null
  return message.state === 'connected' || message.state === 'reconnecting' ? message.state : null
}

/** Message sent to the embedded GUI to navigate to a specific session. */
export interface OpenSessionMessage {
  type: 'dsh/open-session'
  version: 1
  sessionId: string
}

/**
 * Format an open-session message for the embedded GUI.
 * @param sessionId - Session to open.
 * @returns Serialized postMessage payload.
 */
export function openSessionMessageOf(sessionId: string): OpenSessionMessage {
  return {
    type: 'dsh/open-session',
    version: 1,
    sessionId,
  }
}
