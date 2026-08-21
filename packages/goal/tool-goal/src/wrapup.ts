/** Model-visible wrap-up instruction for a terminal autonomous goal update. */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { GoalView } from '@deepseek-ai/dsh-goal'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'

const GROUNDING =
  'Report only what earlier rounds and tool results in this session actually establish; '
  + 'when a detail is not in the session, say so instead of inventing it. '

/** Provider-reported token usage and elapsed time for one finished goal. */
export interface GoalWrapupStats {
  /** Total provider-reported tokens consumed since the goal was created; absent when none reported usage. */
  readonly tokens?: number
  /** Elapsed wall-clock time since the goal was created, in milliseconds. */
  readonly elapsedMs: number
}

/** Render an elapsed duration as a compact `Xd Ym Zs` string. */
function formatElapsed(elapsedMs: number): string {
  const total = Math.max(0, Math.floor(elapsedMs / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  return hours > 0
    ? `${hours}h ${minutes}m ${seconds}s`
    : minutes > 0
      ? `${minutes}m ${seconds}s`
      : `${seconds}s`
}

/** Render the temporary human-readable resource line, absent when no usage reported. */
function resourceLine(stats: GoalWrapupStats): string {
  if (stats.tokens === undefined) {
    return `The whole goal took ${formatElapsed(stats.elapsedMs)}. State this once in your closing message.\n`
  }
  return `The whole goal took ${formatElapsed(stats.elapsedMs)} and consumed ${stats.tokens.toLocaleString('en-US')} tokens. State both numbers once in your closing message.\n`
}

/**
 * Compute the whole-goal resource numbers for a terminal autonomous update.
 * Tokens are the provider-reported totals (uncached and cached input plus
 * output) from every assistant step after the goal's create mutation, which
 * span all retained rounds and the wrap-up turn before completion. Time is the
 * logged wall-clock span from the create mutation to the latest session event,
 * so both numbers are deterministic and replayable from the session log.
 * @param agent - owning live agent whose session log and created-at anchor the count.
 * @param goal - the terminal goal view.
 * @returns the summed token count (when any step reported usage) and elapsed time.
 */
export function goalWrapupStats(agent: Agent, goal: GoalView): GoalWrapupStats {
  let createSeq = -1
  let lastTime = goal.createdAt
  let tokens = 0
  let reported = false
  for (const event of agent.session.events) {
    lastTime = event.time
    if (event.type === 'goal/change' && event.data.operation === 'create'
      && event.data.goal.id === goal.id) {
      createSeq = event.seq
    } else if (createSeq >= 0 && event.type === 'assistant/message' && event.data.usage !== undefined) {
      tokens += event.data.usage.inputTokens + event.data.usage.outputTokens
        + (event.data.usage.cacheReadTokens ?? 0) + (event.data.usage.cacheWriteTokens ?? 0)
      reported = true
    }
  }
  return {
    ...reported ? { tokens } : {},
    elapsedMs: Math.max(0, lastTime - goal.createdAt),
  }
}

/**
 * Render the closing-message instruction injected after an autonomous goal
 * round reports `complete` or `blocked`, replacing the former hard turn stop
 * so the model still addresses the user once before the turn ends.
 * @param objective - the terminal goal's objective, echoed for grounding.
 * @param blockedReason - the validated report for `blocked`; omitted for `complete`.
 * @param stats - whole-goal tokens and elapsed time; omitted for Direct-human or replay callers.
 * @returns a fresh one-block context for `ToolRunContext.deferContext()`.
 */
export function renderWrapupContext(
  objective: string,
  blockedReason?: string,
  stats?: GoalWrapupStats,
): ContentBlock[] {
  const heading = `Objective: ${JSON.stringify(objective)}\n`
  const statsBlock = stats === undefined ? '' : resourceLine(stats)
  const text = blockedReason === undefined
    ? '<goal_complete>\n'
      + heading
      + statsBlock
      + 'The goal is marked complete and this autonomous run is ending. Write the closing '
      + 'message to the user now: state the outcome, summarize what was done and how it was '
      + 'verified, and point to the concrete results (files, commits, or other artifacts). '
      + GROUNDING
      + 'Note anything the user should review or do next. Address the user directly. Do not '
      + "call any more tools in this run; further work waits for the user's next instruction.\n"
      + '</goal_complete>'
    : '<goal_blocked>\n'
      + heading
      + statsBlock
      + `Blocked: ${JSON.stringify(blockedReason)}\n`
      + 'The goal is marked blocked and this autonomous run is ending. Write the closing '
      + 'message to the user now: state what has been completed so far, describe the concrete '
      + 'blocking condition and what you tried, and say exactly what you need from the user to '
      + 'continue. '
      + GROUNDING
      + 'Address the user directly. Do not call any more tools in this run; further work '
      + "waits for the user's next instruction.\n"
      + '</goal_blocked>'
  return [{ type: 'text', text }]
}
