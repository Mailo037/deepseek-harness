/** Event-backed, bounded summaries for authorized Session history. */

import { extractSessionEventText, type SessionLogSnapshot } from '@deepseek-ai/dsh-session-query'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

interface TitleView {
  readonly text: string
}

/** Controls for one textual Session summary. */
export interface SessionSummaryOptions {
  /** Largest number of evidence entries in each repeated section. */
  readonly maxItems: number
  /** Largest UTF-16 text span retained from one evidence entry. */
  readonly maxEvidenceCharacters: number
}

interface Evidence {
  readonly seq: number
  readonly text: string
}

const DECISION_WORDING = /\b(decid(?:e|ed|ing)|cho(?:ose|sen)|select(?:ed|ing)?|will|going to)\b/iu
const FILE_MUTATION_TOOLS = new Set(['write', 'edit', 'str_replace_editor', 'apply_patch'])
const PATH_KEYS = new Set(['path', 'file', 'file_path', 'filePath'])

/**
 * Render only facts that can be tied back to events in one validated Session log.
 * @param snapshot - complete detached Session log selected by `ctx.sessionQuery`.
 * @param title - title obtained from the authorized Session observation.
 * @param options - item and excerpt limits owned by the caller configuration.
 * @returns readable summary with the supporting sequence number beside each fact.
 */
export function formatSessionSummary(
  snapshot: SessionLogSnapshot,
  title: TitleView,
  options: SessionSummaryOptions,
): string {
  const objective = firstObjective(snapshot.events, options.maxEvidenceCharacters)
  const decisions = recordedDecisions(snapshot.events, options)
  const changedFiles = observedChangedFiles(snapshot.events, options.maxItems)
  const openTodos = latestOpenTodos(snapshot.events, options)
  const last = snapshot.events.at(-1)
  const lines = [
    `Session ${snapshot.session.id} — ${title.text}`,
    `Created: ${new Date(snapshot.session.createdAt).toISOString()}`,
    `Last recorded event: ${last === undefined ? 'none' : `seq ${last.seq} | ${last.type} | ${new Date(last.time).toISOString()}`}`,
    '',
    'Objective:',
  ]
  renderEvidence(lines, objective === undefined ? [] : [objective], 'No user message was recorded.')
  lines.push('', 'Recorded decisions:')
  renderEvidence(lines, decisions, 'No assistant message with explicit decision wording was recorded.')
  lines.push('', 'Observed changed files:')
  renderEvidence(lines, changedFiles, 'No supported file-mutation tool call was recorded.')
  lines.push('', 'Open todos:')
  renderEvidence(lines, openTodos, 'No open todo was recorded.')
  lines.push('', 'Revision: not recorded in the Session header.')
  return lines.join('\n')
}

function firstObjective(events: readonly SessionEvent[], maxCharacters: number): Evidence | undefined {
  const event = events.find(candidate => candidate.type === 'user/message')
  if (event === undefined) return undefined
  const text = excerpt(extractSessionEventText(event), maxCharacters)
  return text.length === 0 ? undefined : { seq: event.seq, text }
}

function recordedDecisions(
  events: readonly SessionEvent[],
  options: SessionSummaryOptions,
): Evidence[] {
  const values: Evidence[] = []
  for (const event of events) {
    if (event.type !== 'assistant/message') continue
    const text = excerpt(extractSessionEventText(event), options.maxEvidenceCharacters)
    if (text.length > 0 && DECISION_WORDING.test(text)) values.push({ seq: event.seq, text })
  }
  return values.slice(-options.maxItems)
}

function observedChangedFiles(events: readonly SessionEvent[], maxItems: number): Evidence[] {
  const values: Evidence[] = []
  const seen = new Set<string>()
  for (const event of events) {
    if (event.type !== 'tool/call' || !FILE_MUTATION_TOOLS.has(event.data.name)) continue
    const parsed = parseArguments(event.data.arguments)
    for (const path of pathsIn(parsed)) {
      if (seen.has(path)) continue
      seen.add(path)
      values.push({ seq: event.seq, text: path })
    }
  }
  return values.slice(-maxItems)
}

function latestOpenTodos(events: readonly SessionEvent[], options: SessionSummaryOptions): Evidence[] {
  const todos = events.findLast(event => event.type === 'todo/write')
  if (todos === undefined) return []
  return todos.data.todos
    .filter(todo => todo.status !== 'completed')
    .slice(0, options.maxItems)
    .map(todo => ({ seq: todos.seq, text: excerpt(`${todo.status}: ${todo.content}`, options.maxEvidenceCharacters) }))
}

function parseArguments(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

function pathsIn(value: unknown): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return []
  const paths: string[] = []
  for (const [key, nested] of Object.entries(value)) {
    if (PATH_KEYS.has(key) && typeof nested === 'string' && nested.length > 0) paths.push(nested)
  }
  return paths
}

function renderEvidence(lines: string[], values: readonly Evidence[], empty: string): void {
  if (values.length === 0) {
    lines.push(`- ${empty}`)
    return
  }
  for (const value of values) lines.push(`- seq ${value.seq}: ${value.text}`)
}

function excerpt(value: string, maxCharacters: number): string {
  const normalized = value.trim().replace(/\s+/gu, ' ')
  if (normalized.length <= maxCharacters) return normalized
  return `${normalized.slice(0, Math.max(0, maxCharacters - 1))}…`
}
