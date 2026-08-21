/**
 * dsh-shell-command's owned branded id: shell-command lifecycle pairing
 * across the session log, the wire admission response, and client-side
 * flow pairing.
 *
 * The `Branded<B>` primitive lives in `@deepseek-ai/dsh-brand`; this module
 * is a pure type/constructor outlet (no cordis imports, no module
 * augmentation) so wire and client programs can name the brand without
 * loading the host plugin's Context merges — the `dsh-commands/brand`
 * shape.
 *
 * @module @deepseek-ai/dsh-shell-command/brand
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/**
 * Pairs one shell command's `shell/run`/`shell/done` lifecycle records with
 * each other and with the `shellCommand.run` admission response. Minted by
 * the executor, monotonic per service instance.
 */
export type ShellCommandId = Branded<'ShellCommandId'>

/**
 * Brand a string as a {@link ShellCommandId}.
 * @param id - the executor-minted pairing id.
 * @returns the same string, branded; no validation is performed.
 */
export function ShellCommandId(id: string): ShellCommandId {
  return id as ShellCommandId
}
