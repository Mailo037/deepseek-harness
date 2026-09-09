/**
 * NotificationRuntime: owner of the durable opt-in preference and the
 * session-state watcher that plays its sounds. Reads and writes go through
 * the Host-backed settings scope; state observations subscribe to the shared
 * sessions list snapshot store — the same authority the sidebar status dots
 * project. At most one sound plays per observed flush (most urgent kind wins).
 */
import type { Context } from '@deepseek-ai/cordis'
import type {
  ObservableSnapshot, SessionId, SessionListState, SessionSummary, SettingsScope,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  ATTENTION_SOUND_FIELD, DEFAULT_NOTIFICATION_SETTINGS, DONE_SOUND_FIELD, ENABLED_FIELD,
  ERROR_SOUND_FIELD, isNotificationSound,
  type NotificationSettings, type NotificationSound,
} from '../notification-settings.ts'
import type { SoundPlayer } from './sounds.ts'
import { listEvents, type NotificationEvent, type NotificationEventKind } from './watcher.ts'

/** Immutable preference state published on every accepted change. */
export interface NotificationSnapshot extends NotificationSettings {
  /** Monotonic change counter (local writes and Host adoptions). */
  revision: number
  /**
   * Live browser permission for system notifications, re-read on demand —
   * the row projects this instead of the preference switch alone, so a
   * browser-blocked site reads as blocked even while the opt-in is on.
   */
  permission: NotificationPermissionState
}

/** Browser notification-permission states the row projects. */
export type NotificationPermissionState = 'unsupported' | 'default' | 'granted' | 'denied'

/**
 * Read the browser's notification-permission state.
 * @returns the current permission, or `unsupported` where no Notification API exists.
 */
export function readBrowserPermission(): NotificationPermissionState {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission
}

/** Settings field carrying an event kind's sound. */
function soundField(kind: NotificationEventKind): string {
  switch (kind) {
    case 'done': return DONE_SOUND_FIELD
    case 'attention': return ATTENTION_SOUND_FIELD
    case 'error': return ERROR_SOUND_FIELD
  }
}

/** Play order when several kinds moved in one flush: most urgent first. */
const PLAY_ORDER: readonly NotificationEventKind[] = ['error', 'attention', 'done']

/** Sessions-store face the watcher needs (the runtime service's list snapshot). */
export interface SessionsListSource {
  list: ObservableSnapshot<SessionListState>
}

/** Sessions face supporting list observation and session opening. */
export interface NotificationSessionsTarget extends SessionsListSource {
  open(id: SessionId): void
}

/** Browser permission face the row's status line and request gesture go through. */
export interface PermissionFace {
  /**
   * Read the current permission state.
   * @returns the browser's live permission.
   */
  read: () => NotificationPermissionState
  /**
   * Ask the browser to grant notification permission.
   * @returns settlement with the state the browser answered.
   */
  request: () => Promise<NotificationPermissionState>
}

/** Sink for presenting system or browser notifications for session events. */
export interface NotificationPresenter {
  /**
   * Present a notification for one session event.
   * @param event - Derived notification event.
   * @param summary - Session summary snapshot, when present in the list.
   */
  (event: NotificationEvent, summary: SessionSummary | undefined): void
}

/** Translation face required by the default notification presenter. */
export interface NotificationTranslator {
  /**
   * Translate one notification copy key.
   * @param key - Translation key.
   * @returns Localized string.
   */
  t(key: string): string
}

/**
 * Open a session if present in the list, or defer until the session arrives.
 * @param sessions - outward sessions face.
 * @param sessionId - target session id.
 */
export function openSessionSafely(
  sessions: { open(id: SessionId): void; list: ObservableSnapshot<SessionListState> },
  sessionId: SessionId,
): void {
  const snapshot = sessions.list.getSnapshot()
  if (snapshot.byId[sessionId] !== undefined) {
    sessions.open(sessionId)
    return
  }
  const unsubscribe = sessions.list.subscribe(() => {
    const next = sessions.list.getSnapshot()
    if (next.byId[sessionId] !== undefined) {
      unsubscribe()
      sessions.open(sessionId)
    } else if (next.phase === 'ready') {
      unsubscribe()
    }
  })
}

/**
 * Build the default browser Notification presenter.
 * When permissions are granted, creates a Notification with the session title and event summary.
 * Clicking focuses the window and navigates to the session.
 * @param sessions - outward sessions face with open capability.
 * @param translator - optional localization translation function.
 * @returns NotificationPresenter instance.
 */
export function defaultNotificationPresenter(
  sessions: { open(id: SessionId): void; list: ObservableSnapshot<SessionListState> },
  translator?: NotificationTranslator,
): NotificationPresenter {
  return (event, summary) => {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    const title = summary?.displayTitle ?? summary?.title ?? String(event.sessionId)
    let body = ''
    switch (event.kind) {
      case 'done':
        body = translator ? translator.t('notifications.event.done') : 'Work finished'
        break
      case 'attention':
        body = translator ? translator.t('notifications.event.attention') : 'Needs your attention'
        break
      case 'error':
        body = translator ? translator.t('notifications.event.error') : 'Error occurred'
        break
    }
    try {
      const notification = new Notification(title, {
        body,
        tag: `dsh-${event.sessionId}`,
      })
      notification.onclick = () => {
        if (typeof window !== 'undefined' && typeof window.focus === 'function') {
          window.focus()
        }
        openSessionSafely(sessions, event.sessionId)
        notification.close()
      }
    } catch {
      // In restricted or headless environments, drop silently.
    }
  }
}

/**
 * Preference owner + transition watcher. Writes only through
 * {@link setEnabled}/{@link setSound}; continuous sync only through adoption
 * of the settings scope.
 */
export class NotificationRuntime {
  private readonly ctx: Context
  private enabled = DEFAULT_NOTIFICATION_SETTINGS.enabled
  private doneSound = DEFAULT_NOTIFICATION_SETTINGS.doneSound
  private attentionSound = DEFAULT_NOTIFICATION_SETTINGS.attentionSound
  private errorSound = DEFAULT_NOTIFICATION_SETTINGS.errorSound
  private revision = 0
  private snapshot: NotificationSnapshot = { ...DEFAULT_NOTIFICATION_SETTINGS, permission: 'unsupported', revision: 0 }
  /** The previous list observation; undefined until the constructor seeds it. */
  private prev: SessionListState | undefined
  /** Last observed browser permission; refreshed on demand, never assumed. */
  private permission: NotificationPermissionState = 'unsupported'

  /**
   * @param ctx - owning context (change events are emitted on it; scope/store listeners release through ctx.effect on dispose).
   * @param host - durable preference scope owned by the same plugin.
   * @param sessions - sessions service whose list snapshot feeds the watcher.
   * @param play - sound sink (the Web Audio player in production).
   * @param notify - optional notification sink for browser/system notifications.
   */
  constructor(
    ctx: Context,
    private readonly host: SettingsScope<NotificationSettings>,
    sessions: SessionsListSource,
    private readonly play: SoundPlayer,
    private readonly notify?: NotificationPresenter,
    private readonly permissions: PermissionFace = {
      read: readBrowserPermission,
      request: () => {
        if (typeof Notification === 'undefined') return Promise.resolve('unsupported')
        return Notification.requestPermission()
      },
    },
  ) {
    this.ctx = ctx
    ctx.effect(() => host.subscribe(() => { this.adopt() }), 'ui-notifications: settings scope adoption')
    ctx.effect(() => sessions.list.subscribe(() => { this.observe(sessions.list) }), 'ui-notifications: session list observation')
    this.permission = this.permissions.read()
    this.adopt()
    // Seed the baseline without announcing: a fresh boot never replays the
    // states every row already carries.
    this.prev = sessions.list.getSnapshot()
    this.publish()
  }

  /**
   * Read the current immutable preference snapshot.
   * @returns Current notification preferences.
   */
  getSnapshot(): NotificationSnapshot {
    return this.snapshot
  }

  /**
   * Switch the master opt-in — the only enable write entry.
   * @param enabled - whether transition sounds may play.
   */
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return
    this.enabled = enabled
    void this.host.set(ENABLED_FIELD, enabled)
    this.publish()
  }

  /**
   * Assign one event kind's sound — the only per-event write entry.
   * @param kind - event whose sound changes.
   * @param sound - a built-in sound id; unknown ids throw.
   */
  setSound(kind: NotificationEventKind, sound: NotificationSound): void {
    if (!isNotificationSound(sound)) throw new Error(`sound "${String(sound)}" is not a built-in notification sound`)
    if (this.soundOf(kind) === sound) return
    if (kind === 'done') this.doneSound = sound
    else if (kind === 'attention') this.attentionSound = sound
    else this.errorSound = sound
    void this.host.set(soundField(kind), sound)
    this.publish()
  }

  /**
   * Preview one event's current sound — an explicit user gesture, so it plays
   * regardless of the master opt-in.
   * @param kind - event whose assigned sound to play.
   */
  preview(kind: NotificationEventKind): void {
    this.play(this.soundOf(kind))
  }

  /**
   * Re-read the browser permission state and republish when it moved — the
   * user can grant or block in the browser's site settings while this page
   * stays open, and no event announces that.
   */
  refreshPermission(): void {
    const next = this.permissions.read()
    if (next === this.permission) return
    this.permission = next
    this.publish()
  }

  /**
   * Ask the browser to grant notification permission. Only meaningful from a
   * user gesture while the state is `default`; republishes whatever the
   * browser answered. A `denied` browser never re-prompts — the row's hint
   * names the browser site settings instead.
   */
  async requestPermission(): Promise<void> {
    if (this.permission !== 'default') return
    const before = this.permission
    try {
      this.permission = await this.permissions.request()
    } catch {
      // A dismissed or failed prompt is not an error; the browser's state
      // stays authoritative and the comparison below publishes it.
    }
    if (this.permission !== before) this.publish()
  }

  private soundOf(kind: NotificationEventKind): NotificationSound {
    return kind === 'done' ? this.doneSound : kind === 'attention' ? this.attentionSound : this.errorSound
  }

  /** Adopt the scope's accepted durable section without writing it back. */
  private adopt(): void {
    const section = this.host.getSnapshot().value
    if (section === undefined) return
    this.enabled = section.enabled
    this.doneSound = section.doneSound
    this.attentionSound = section.attentionSound
    this.errorSound = section.errorSound
    this.publish()
  }

  /** Observe one list flush: diff against the previous snapshot and play. */
  private observe(list: ObservableSnapshot<SessionListState>): void {
    const next = list.getSnapshot()
    const events = listEvents(this.prev, next)
    this.prev = next
    if (!this.enabled || events.length === 0) return
    const moved = new Set(events.map(event => event.kind))
    for (const kind of PLAY_ORDER) {
      if (moved.has(kind)) {
        this.play(this.soundOf(kind))
        break
      }
    }
    if (this.notify !== undefined) {
      for (const event of events) {
        const summary = next.byId[event.sessionId]
        this.notify(event, summary)
      }
    }
  }

  private publish(): void {
    this.revision += 1
    this.snapshot = {
      enabled: this.enabled,
      doneSound: this.doneSound,
      attentionSound: this.attentionSound,
      errorSound: this.errorSound,
      permission: this.permission,
      revision: this.revision,
    }
    this.ctx.emit('notifications/change', this.snapshot)
  }
}
