/**
 * The `!` input-trigger source: intercepts enter on a `!`-prefixed composer
 * line, clears the draft through the scoped consume-token event, and fires the
 * host `shellCommand.run` RPC. The durable `shell/run`/`shell/done` events
 * render as the shell-command chat node; only a transport failure surfaces as
 * a composer notice.
 *
 * @module @deepseek-ai/dsh-client-ui-shell-command/client
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  CandidateRequest, ClientSessionContext, InputTriggerCandidate, InputTriggerSource,
  PickOutcome, SubmitEnvelope,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'

/** Structural conversation face for the composer-notice outlet. */
interface NoticeFace {
  input: {
    for(actx: ClientContext): { notify(level: 'info' | 'error', text: string): void }
  }
}

/**
 * The adjudication-only `!` source. No menu opens for `!` (the detector never
 * yields it); the enter-time adjudication poll reaches this source because the
 * line starts with the trigger. A non-empty command is consumed and executed;
 * a bare `!` falls through to the default sink as an ordinary message.
 */
export class ShellCommandSource implements InputTriggerSource {
  readonly trigger = '!'
  readonly name = 'shell'
  readonly order = 0

  constructor(
    private readonly rootCtx: Context,
    private readonly t: TranslateNS<'shellCommand'>,
  ) {}

  candidates(_session: ClientSessionContext, _req: CandidateRequest): Promise<readonly InputTriggerCandidate[]> {
    return Promise.resolve([])
  }

  onPick(): PickOutcome {
    // No menu: picks never reach this source.
    return undefined
  }

  // oxlint-disable-next-line typescript/require-await -- validation failures are rejected promises in the trigger API
  async matchEnter(
    session: ClientSessionContext,
    line: string,
    signal: AbortSignal,
    envelope: SubmitEnvelope,
  ): Promise<PickOutcome> {
    if (!line.startsWith('!')) return undefined
    const command = line.slice(1).trim()
    if (command === '') return undefined
    if (envelope.images > 0) {
      throw new Error(this.t('notice.imagesUnsupported'))
    }
    // Clear the whole line through the input's bare-token guard (CAS on the
    // trimmed draft), then run detached — the durable events own the card.
    this.consume(session.sessionId, line)
    this.run(session.sessionId, command, signal)
    return 'handled'
  }

  /** Dispatch the scoped consume-token bail event for the full line. */
  private consume(id: SessionId, line: string): void {
    const actx = this.scopeFor(id)
    if (actx === undefined) return
    actx.bail(actx, 'slash/input-consume-token', {
      guard: { kind: 'bare-token', token: line },
    })
  }

  /** Fire the host execution; a transport failure surfaces as one composer notice. */
  private run(id: SessionId, command: string, signal: AbortSignal): void {
    void this.rootCtx.remote.shellCommand.run(id, command, signal).then(
      (result) => {
        if (result.ok) return
        // Admission failure (empty command): immediate composer feedback.
        this.notice(id, 'error', `shell command failed: ${result.error.message}`)
      },
      (error: unknown) => {
        this.notice(id, 'error', error instanceof Error ? error.message : String(error))
      },
    )
  }

  /** Route one notice to the session's composer (scope gone = attempt died with it). */
  private notice(id: SessionId, level: 'info' | 'error', text: string): void {
    const actx = this.scopeFor(id)
    if (actx === undefined) return
    const conversation = actx.get('conversation') as NoticeFace | undefined
    conversation?.input.for(actx).notify(level, text)
  }

  /** id → actx interchange (registered exchange point: this source coordinates for projection-only sources). */
  private scopeFor(id: SessionId): ClientContext | undefined {
    const sessions = this.rootCtx.get('sessions')
    return sessions?.scope(id)
  }
}
