import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { foldSessionTitle } from '@deepseek-ai/dsh-session-title'
import type { DeviceChannel } from './device-channel.ts'
import type { RemoteNotification } from './types.ts'

/** Configuration for the notification bridge. */
export interface BridgeConfig {
  readonly notifyOnError: boolean
  readonly notifyOnCompleted: boolean
  readonly notifyOnAttention?: boolean
}

/**
 * Subscribes to durable session events and forwards noteworthy events
 * (turn/end errors, completed turns, user attention requests) as
 * notifications to connected devices. Messages identify the session by its
 * latest durable title, falling back to the session id before a title exists.
 */
export class NotificationBridge {
  private readonly dispose: () => void

  constructor(
    ctx: Context,
    private readonly config: BridgeConfig,
    private readonly channel: DeviceChannel,
  ) {
    const handler = (session: Session, event: SessionEvent): void => {
      this.onSessionEvent(session, event)
    }
    this.dispose = ctx.on('session/event', handler)
  }

  /** Stop listening and release the bridge. */
  close(): void {
    this.dispose()
  }

  private onSessionEvent(session: Session, event: SessionEvent): void {
    const sessionLabel = foldSessionTitle(session.events)?.title ?? session.id
    const rawEvent = event as unknown as { type: string; data?: unknown; time: number }
    if (rawEvent.type === 'approval/asked' && (this.config.notifyOnAttention ?? true)) {
      const notification: RemoteNotification = {
        kind: 'attention',
        sessionId: session.id,
        message: `${sessionLabel} needs your approval`,
        time: new Date(rawEvent.time).toISOString(),
      }
      this.channel.broadcast(notification)
      return
    }
    if (rawEvent.type === 'tool/call' && (rawEvent.data as { name?: string } | undefined)?.name === 'ask_user_question' && (this.config.notifyOnAttention ?? true)) {
      const notification: RemoteNotification = {
        kind: 'attention',
        sessionId: session.id,
        message: `${sessionLabel} has a question for you`,
        time: new Date(rawEvent.time).toISOString(),
      }
      this.channel.broadcast(notification)
      return
    }
    if (event.type !== 'turn/end') return
    const reason = event.data.reason
    if (reason.kind === 'error' && this.config.notifyOnError) {
      const notification: RemoteNotification = {
        kind: 'turn-error',
        sessionId: session.id,
        message: `Error in ${sessionLabel}: ${reason.error.message}`,
        time: new Date(event.time).toISOString(),
      }
      this.channel.broadcast(notification)
    } else if (reason.kind === 'completed' && this.config.notifyOnCompleted) {
      const notification: RemoteNotification = {
        kind: 'turn-completed',
        sessionId: session.id,
        message: `${sessionLabel} completed`,
        time: new Date(event.time).toISOString(),
      }
      this.channel.broadcast(notification)
    }
  }
}
