import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { DeviceChannel } from './device-channel.ts'
import type { RemoteNotification } from './types.ts'

/** Configuration for the notification bridge. */
export interface BridgeConfig {
  readonly notifyOnError: boolean
  readonly notifyOnCompleted: boolean
}

/**
 * Subscribes to durable session events and forwards noteworthy events
 * (turn/end errors, completed turns) as notifications to connected devices.
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
    if (event.type !== 'turn/end') return
    const reason = event.data.reason
    if (reason.kind === 'error' && this.config.notifyOnError) {
      const notification: RemoteNotification = {
        kind: 'turn-error',
        sessionId: session.id,
        message: `Error in session ${session.id}: ${reason.error.message}`,
        time: new Date(event.time).toISOString(),
      }
      this.channel.broadcast(notification)
    } else if (reason.kind === 'completed' && this.config.notifyOnCompleted) {
      const notification: RemoteNotification = {
        kind: 'turn-completed',
        sessionId: session.id,
        message: `Session ${session.id} completed`,
        time: new Date(event.time).toISOString(),
      }
      this.channel.broadcast(notification)
    }
  }
}
