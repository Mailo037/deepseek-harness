/**
 * Browser orchestration for an AI-assisted Harness update review. The
 * controller prepares one ordinary Workspace session, lets the user choose
 * from that session's Host-reported model directory, and sends a guarded
 * integration brief into the visible conversation.
 */

import type {
  IApiClient, ModelProviderGroup, ModelSelection, SessionId, WorkspaceId,
} from '@deepseek-ai/dsh-api-remotes/client'
import type {
  ISessions, IWorkspaces, SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** Official DeepSeek source whose releases and default branch the reviewer discovers. */
export const OFFICIAL_HARNESS_REPOSITORY = 'https://github.com/deepseek-ai/deepseek-harness.git'

/** Maintainer source shipped as this unofficial Harness. */
export const UNOFFICIAL_HARNESS_REPOSITORY = 'https://github.com/Mailo037/deepseek-harness.git'

/** User-selectable update source. */
export type HarnessUpdateSource = 'unofficial' | 'official'

/** Stable source metadata; labels stay in the UI dictionary. */
export const HARNESS_UPDATE_SOURCES = [
  { id: 'unofficial', repository: UNOFFICIAL_HARNESS_REPOSITORY },
  { id: 'official', repository: OFFICIAL_HARNESS_REPOSITORY },
] as const satisfies readonly { id: HarnessUpdateSource; repository: string }[]

/** One user-selectable model route from the prepared session's directory. */
export interface HarnessSyncModelOption {
  /** Opaque UI key; selection resolves by lookup rather than parsing it. */
  id: string
  /** Provider display name. */
  group: string
  /** Model display name. */
  label: string
  /** Complete selection submitted before the review prompt. */
  selection: ModelSelection
}

/** Lifecycle of the About card's AI-assisted Harness update flow. */
export type HarnessSyncPhase = 'idle' | 'preparing' | 'ready' | 'starting' | 'error'

/** Observable UI state for the AI-assisted Harness update flow. */
export interface HarnessSyncState {
  /** Current operation phase. */
  phase: HarnessSyncPhase
  /** Upstream repository the AI compares and integrates. */
  source: HarnessUpdateSource
  /** Workspace path captured when preparation began. */
  targetPath: string | null
  /** Prepared blank session, retained across model-choice changes. */
  sessionId: SessionId | null
  /** Host-advertised choices plus an unadvertised current route when needed. */
  models: readonly HarnessSyncModelOption[]
  /** Opaque id of the model used for the review. */
  selectedModelId: string | null
  /** Last operation failure. */
  error: string | null
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function selectionMatches(left: ModelSelection, right: ModelSelection): boolean {
  return left.provider === right.provider
    && left.model === right.model
    && left.reasoningEffort === right.reasoningEffort
}

function optionId(index: number): string {
  return `model-${index}`
}

/** Flatten provider groups while preserving their advertised order. */
function modelOptions(groups: readonly ModelProviderGroup[], current: ModelSelection): HarnessSyncModelOption[] {
  const options: HarnessSyncModelOption[] = []
  for (const group of groups) {
    for (const model of group.models) {
      options.push({
        id: optionId(options.length),
        group: group.name,
        label: model.name,
        selection: {
          provider: group.id,
          model: model.id,
          ...(model.reasoning?.defaultEffort === undefined
            ? {}
            : { reasoningEffort: model.reasoning.defaultEffort }),
        },
      })
    }
  }
  if (!options.some(option => selectionMatches(option.selection, current))) {
    options.unshift({
      id: 'current',
      group: current.provider,
      label: current.model,
      selection: current,
    })
  }
  return options
}

/**
 * Build the durable user message that starts the visible review session.
 * @param targetPath - local Workspace path the session is already scoped to.
 * @param source - selected maintainer or official upstream.
 * @returns the complete safety and integration brief.
 */
export function harnessIntegrationPrompt(targetPath: string, source: HarnessUpdateSource): string {
  const repository = source === 'unofficial'
    ? UNOFFICIAL_HARNESS_REPOSITORY
    : OFFICIAL_HARNESS_REPOSITORY
  const sourceRole = source === 'unofficial'
    ? 'the maintained unofficial Harness distribution'
    : 'the official DeepSeek Harness upstream'
  return `Review and safely integrate applicable changes from ${sourceRole} into this locally customized Harness.

Local working tree: ${targetPath}
Selected update source: ${repository}

First read the repository's AGENTS.md and every instruction file that applies to files you inspect or change. Then:

1. Inspect the local Git status, local commits, remotes, and version. Treat every pre-existing tracked or untracked change that is not proven to come from the selected source as user-owned customization; preserve it regardless of who authored it.
2. Discover the selected source's default branch and newest release tag. Fetch it into a namespaced remote-tracking ref without switching the active branch.
3. Report the local version, selected-source version, merge base, ahead/behind counts, and the important source changes since that base.
4. Build a three-part change ledger: selected-source changes, maintained fork/product changes, and local user customizations. Classify each source change as integrate, adapt around a customization, or intentionally leave out, including migrations, documentation, tests, and likely conflicts.
5. Present a concrete integration plan and wait for my explicit approval before editing tracked files.

After approval, work on an isolated harness-sync/* branch and worktree. Integrate deliberately instead of blindly merging the selected source. Reapply compatible source changes while retaining maintained-fork behavior and local user customizations; resolve every overlap explicitly and test both the updated product behavior and preserved customization. Never reset, rebase, merge, or clean the active working tree. Do not push, merge, release, deploy, or restart the app without a separate explicit request. Finish with the exact source changes integrated, customizations preserved, checks, remaining gaps, and a review path.`
}

/** State owner for the Harness update source, model choice, and session launch. */
export class HarnessSyncStore {
  /** Shared observable rendered by the About section. */
  readonly store: SnapshotStore<HarnessSyncState> = createSnapshotStore({
    phase: 'idle',
    source: 'unofficial',
    targetPath: null,
    sessionId: null,
    models: [],
    selectedModelId: null,
    error: null,
  })

  private currentSelection: ModelSelection | null = null

  /**
   * @param api - Host wire face used for the prepared session's model directory and selection.
   * @param sessions - session navigation and visible conversation binding.
   * @param workspaces - blank-session preparation for the selected Workspace.
   */
  constructor(
    private readonly api: Pick<IApiClient, 'sessions'>,
    private readonly sessions: Pick<ISessions, 'binding' | 'open'>,
    private readonly workspaces: Pick<IWorkspaces, 'connectWorkspace'>,
  ) {}

  /**
   * Select the repository whose changes the prepared AI session reviews.
   * @param source - maintained distribution or official upstream.
   */
  selectSource(source: HarnessUpdateSource): void {
    if (!HARNESS_UPDATE_SOURCES.some(candidate => candidate.id === source)) return
    this.store.update((state) => { state.source = source })
  }

  /**
   * Prepare a blank session in the selected Workspace and load its model directory.
   * Concurrent gestures collapse into the current operation.
   * @param workspaceId - selected Harness Workspace.
   * @param targetPath - display path and prompt fact for that Workspace.
   */
  async prepare(workspaceId: WorkspaceId, targetPath: string): Promise<void> {
    const current = this.store.getSnapshot()
    if (current.phase === 'preparing' || current.phase === 'starting') return
    this.store.update((state) => {
      state.phase = 'preparing'
      state.targetPath = targetPath
      state.error = null
    })
    try {
      const sessionId = await this.workspaces.connectWorkspace(workspaceId)
      const response = await this.api.sessions.models({ sessionId })
      if (!response.result.ok) throw new Error(response.result.error.message)
      const directory = response.result.value
      if (!directory.routable) throw new Error('The current model provider is unavailable.')
      const models = modelOptions(directory.groups, directory.current)
      const selected = models.find(option => selectionMatches(option.selection, directory.current)) ?? models[0]
      if (selected === undefined) throw new Error('No usable AI model is configured.')
      this.currentSelection = directory.current
      this.store.update((state) => {
        state.phase = 'ready'
        state.sessionId = sessionId
        state.models = models
        state.selectedModelId = selected.id
      })
    } catch (error) {
      this.store.update((state) => {
        state.phase = 'error'
        state.sessionId = null
        state.models = []
        state.selectedModelId = null
        state.error = messageOf(error)
      })
    }
  }

  /**
   * Select one prepared model by its opaque option id.
   * @param id - opaque id from the prepared model options.
   */
  selectModel(id: string): void {
    if (!this.store.getSnapshot().models.some(option => option.id === id)) return
    this.store.update((state) => { state.selectedModelId = id })
  }

  /**
   * Select the chosen model, send the guarded brief, and navigate to the review session.
   * @returns true when the Host accepted the prompt and navigation occurred.
   */
  async start(): Promise<boolean> {
    const current = this.store.getSnapshot()
    if (current.phase !== 'ready' || current.sessionId === null || current.targetPath === null) return false
    const option = current.models.find(model => model.id === current.selectedModelId)
    if (option === undefined) return false
    this.store.update((state) => {
      state.phase = 'starting'
      state.error = null
    })
    try {
      if (this.currentSelection === null || !selectionMatches(option.selection, this.currentSelection)) {
        const selected = await this.api.sessions.selectModel({
          sessionId: current.sessionId,
          provider: option.selection.provider,
          model: option.selection.model,
          ...(option.selection.reasoningEffort === undefined
            ? {}
            : { reasoningEffort: option.selection.reasoningEffort }),
        })
        if (!selected.result.ok) throw new Error(selected.result.error.message)
        this.currentSelection = selected.result.value.selected
      }
      const binding = this.sessions.binding(current.sessionId)
      if (binding === undefined) throw new Error('The prepared review session is no longer available.')
      const prompted = await binding.session.prompt([
        { type: 'text', text: harnessIntegrationPrompt(current.targetPath, current.source) },
      ], 'queue')
      if (!prompted.ok) throw new Error(prompted.error.message)
      this.sessions.open(current.sessionId)
      this.store.update((state) => { state.phase = 'ready' })
      return true
    } catch (error) {
      this.store.update((state) => {
        state.phase = 'ready'
        state.error = messageOf(error)
      })
      return false
    }
  }
}
