/**
 * Request channel for the existing hero Workspace picker. Callers can ask for
 * a selection without knowing which directory-flow occupant the composition
 * mounted; the picker remains the sole owner of opening and adopting it.
 */

import { Service } from '@deepseek-ai/cordis'
import type { ClientContext, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Optional request channel served by the Workspace picker UI. */
    workspacePickerRequests: WorkspacePickerRequests
  }
}

/**
 * Monotonic requests consumed by the mounted hero picker. A counter, rather
 * than a boolean, preserves a second explicit request after a close.
 */
export class WorkspacePickerRequests extends Service {
  /** uSES-safe request revision read by the picker entry. */
  readonly store: SnapshotStore<number> = createSnapshotStore(0)

  /** @param ctx - client root context owning this optional UI service. */
  constructor(ctx: ClientContext) {
    super(ctx, 'workspacePickerRequests')
    this.directoryFlowAvailable = () => ctx.slots.entries('conversation.hero.workspace.directoryFlow').length > 0
  }

  private onSettled: ((completed: boolean) => void) | undefined

  /** Whether the composition currently has a hero directory-flow owner. */
  private readonly directoryFlowAvailable: () => boolean

  /**
   * Ask the existing hero picker to open its normal directory-flow route.
   * @param onSettled - restores the requesting UI after pick or cancellation.
   * @returns whether a live directory-flow owner accepted the request.
   */
  request(onSettled: (completed: boolean) => void): boolean {
    if (!this.directoryFlowAvailable()) return false
    this.onSettled = onSettled
    this.store.set(this.store.getSnapshot() + 1)
    return true
  }

  /**
   * Settle the currently pending picker request, if one exists.
   * @param completed - whether the user made a Workspace choice.
   */
  settle(completed: boolean): void {
    const onSettled = this.onSettled
    this.onSettled = undefined
    onSettled?.(completed)
  }
}
