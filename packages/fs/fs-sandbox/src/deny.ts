/**
 * Pure path-pattern matching for the fs-deny Settings namespace. No imports,
 * no side effects — the matching is the only concern.
 *
 * Semantics (gitignore-style):
 * - the pattern's segment sequence must appear somewhere in the path; the
 *   segments AFTER the match are irrelevant (a matching directory denies
 *   everything beneath it)
 * - a leading `/` anchors the match to the tree root
 * - `**` matches zero or more path segments
 * - `*` matches any characters within one path segment
 * @module @deepseek-ai/dsh-fs-sandbox/src/deny
 */

/**
 * Whether `displayPath` is denied by any pattern in the deny list.
 * @param displayPath - the human-readable path of the target.
 * @param patterns - the deny patterns from the configuration.
 * @returns Whether any pattern denies the path.
 */
export function isDenied(displayPath: string, patterns: readonly string[]): boolean {
  if (patterns.length === 0) return false
  const segments = displayPath.replace(/[\\/]+/g, '/').split('/').filter(seg => seg.length > 0)
  for (const pattern of patterns) {
    if (matchAnywhere(segments, pattern)) return true
  }
  return false
}

function matchAnywhere(segments: readonly string[], pattern: string): boolean {
  const pat = pattern.split('/').filter(seg => seg.length > 0)
  if (pat.length === 0) return false
  if (pat.every(seg => seg === '**')) return true
  const rootAnchored = pattern.startsWith('/')
  const startMax = rootAnchored ? 0 : segments.length
  for (let start = 0; start <= startMax; start++) {
    if (matchFrom(segments, pat, start, 0)) return true
  }
  return false
}

/**
 * Recursive glob: match `pat[j..]` against `segments[i..]`. The pattern being
 * exhausted IS a match (remaining segments are allowed — a matching directory
 * denies everything beneath it).
 */
function matchFrom(segments: readonly string[], pat: readonly string[], i: number, j: number): boolean {
  if (j === pat.length) return true
  if (pat[j] === '**') {
    for (let k = i; k <= segments.length; k++) {
      if (matchFrom(segments, pat, k, j + 1)) return true
    }
    return false
  }
  if (i >= segments.length) return false
  const segment = segments[i]
  const pattern = pat[j]
  if (segment === undefined || pattern === undefined) return false
  if (!matchSegment(segment, pattern)) return false
  return matchFrom(segments, pat, i + 1, j + 1)
}

/** Match one path segment against one pattern segment (`*` = any characters). */
function matchSegment(segment: string, pattern: string): boolean {
  const regexStr = '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
  try { return new RegExp(regexStr).test(segment) } catch { return false }
}

/**
 * Whether a shell command references a denied path. Best-effort word scan:
 * every whitespace-separated word of the command is matched against the deny
 * patterns as if it were a path. Covers the common direct forms
 * (`cat .env`, `cat ~/.ssh/config`, `ls node_modules`); it is NOT a kernel
 * boundary — shell quoting and obfuscation can bypass it, which is why the
 * filesystem seam itself stays the hard enforcement.
 * @param command - the raw shell command string.
 * @param patterns - the deny patterns from the configuration.
 * @returns Whether any command word matches a deny pattern.
 */
export function isCommandDenied(command: string, patterns: readonly string[]): boolean {
  if (patterns.length === 0) return false
  for (const word of command.split(/\s+/u)) {
    if (isDenied(word, patterns)) return true
  }
  return false
}
