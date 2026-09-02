/** Model-visible text redaction and complete-result byte bounding. */

const REDACTED = '[redacted]'

const ASSIGNMENT_SECRET = new RegExp(
  String.raw`\b(api[-_]?key|access[-_]?token|auth(?:orization)?|cookie|password|private[-_]?key|secret|token)\b`
  + String.raw`\s*([:=])\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)`,
  'giu',
)
const BEARER_SECRET = /\b(?:bearer|basic)\s+[a-z0-9._~+/=-]{8,}/giu
const KNOWN_SECRET = /\b(?:gh[pousr]_[a-zA-Z0-9_]{20,}|github_pat_[a-zA-Z0-9_]{20,}|sk-[a-zA-Z0-9_-]{16,})\b/gu

/**
 * Replace credential-shaped text before it reaches a model-visible tool result.
 * @param value - text from a Session-derived result.
 * @returns text with recognized credential values replaced by a stable marker.
 */
export function redactModelText(value: string): string {
  return value
    .replace(ASSIGNMENT_SECRET, (_match, name: string, separator: string) => `${name}${separator}${REDACTED}`)
    .replace(BEARER_SECRET, REDACTED)
    .replace(KNOWN_SECRET, REDACTED)
}

/**
 * Truncate one complete model result without splitting an UTF-8 code point.
 * @param value - already-redacted text to bound.
 * @param maxBytes - total UTF-8 byte budget, including the truncation marker.
 * @returns original text or a byte-bounded prefix with an explicit marker.
 */
export function boundModelText(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value) <= maxBytes) return value
  const suffix = '\n[truncated]'
  const contentBudget = maxBytes - Buffer.byteLength(suffix)
  if (contentBudget <= 0) return suffix.slice(0, maxBytes)
  let used = 0
  let result = ''
  for (const codePoint of value) {
    const next = Buffer.byteLength(codePoint)
    if (used + next > contentBudget) break
    result += codePoint
    used += next
  }
  return `${result}${suffix}`
}
