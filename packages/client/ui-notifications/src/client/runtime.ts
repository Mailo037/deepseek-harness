/**
 * NotificationRuntime: owner of the durable opt-in preference and the
 * session-state watcher that plays its sounds. Reads and writes go through
 * the Host-backed settings scope; state observations subscribe to the shared
 * sessions list snapshot store — the same authority the sidebar status dots
 * project. At most one sound plays per observed flush (most urgent kind wins).
 */
import type { Context } from '@deepseek-ai/cordis'
import type {
  ObservableSnapshot, SessionListState, SettingsScope,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  ATTENTION_SOUND_FIELD, DEFAULT_NOTIFICATION_SETTINGS, DONE_SOUND_FIELD, ENABLED_FIELD,
  ERROR_SOUND_FIELD, isNotificationSound,
  type NotificationSettings, type NotificationSound,
} from '../notification-settings.ts'
import type { SoundPlayer } from './sounds.ts'
import { listEvents, type NotificationEventKind } from './watcher.ts'

/** Immutable preference state published on every accepted change. */
export interface NotificationSnapshot extends NotificationSettings {
  /** Monotonic change counter (local writes and Host adoptions). */
  revision: number
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
  private snapshot: NotificationSnapshot = { ...DEFAULT_NOTIFICATION_SETTINGS, revision: 0 }
  /** The previous list observation; undefined until the constructor seeds it. */
  private prev: SessionListState | undefined

  /**
   * @param ctx - owning context (change events are emitted on it; scope/store listeners release through ctx.effect on dispose).
   * @param host - durable preference scope owned by the same plugin.
   * @param sessions - sessions service whose list snapshot feeds the watcher.
   * @param play - sound sink (the Web Audio player in production).
   */
  constructor(
    ctx: Context,
    private readonly host: SettingsScope<NotificationSettings>,
    sessions: SessionsListSource,
    private readonly play: SoundPlayer,
  ) {
    this.ctx = ctx
    ctx.effect(() => host.subscribe(() => { this.adopt() }), 'ui-notifications: settings scope adoption')
    ctx.effect(() => sessions.list.subscribe(() => { this.observe(sessions.list) }), 'ui-notifications: session list observation')
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
    if (!isNotificationSound(sound)) throw new Error(`sound "${sound}" is not a built-in notification sound`)
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
  }

  private publish(): void {
    this.revision += 1
    this.snapshot = {
      enabled: this.enabled,
      doneSound: this.doneSound,
      attentionSound: this.attentionSound,
      errorSound: this.errorSound,
      revision: this.revision,
    }
    this.ctx.emit('notifications/change', this.snapshot)
  }
}
