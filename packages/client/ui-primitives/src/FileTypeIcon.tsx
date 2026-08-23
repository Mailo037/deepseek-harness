/**
 * Extension-driven file-type glyphs for file reference tokens: one classifier
 * from a path (or bare filename) to a glyph kind, plus the matching
 * current-color SVG. Pure presentation — no runtime state.
 */
import type { ReactNode } from 'react'
import { IconBrowseOutline16, IconCodeOutline16 } from './icons/index.tsx'

/** File-token glyph domains: format badges plus the generic fallbacks. */
export type FileTypeIconKind = 'file' | 'image' | 'code' | 'js' | 'ts' | 'py'

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'])
const JS_EXTENSIONS = new Set(['js', 'mjs', 'cjs', 'jsx'])
const TS_EXTENSIONS = new Set(['ts', 'mts', 'cts', 'tsx'])
const CODE_EXTENSIONS = new Set([
  'json', 'yml', 'yaml', 'toml', 'xml', 'html', 'htm', 'css', 'scss', 'less',
  'sh', 'bash', 'zsh', 'ps1', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h',
  'cpp', 'hpp', 'cs', 'php', 'sql', 'lua', 'dart', 'scala', 'pl', 'r',
])

/**
 * Classify one path by its extension (case-insensitive; the final path
 * segment decides). Dotfiles and extensionless names fall back to `file`.
 * @param path - Workspace-relative or absolute path, or a bare filename.
 * @returns The glyph kind the file token renders.
 */
export function fileTypeIconKind(path: string): FileTypeIconKind {
  const name = path.split(/[\\/]/u).pop() ?? path
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return 'file'
  // Quoted display forms (`@"a/x.png"`) keep their closing quote here.
  const ext = name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]+$/u, '')
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  if (ext === 'py') return 'py'
  if (TS_EXTENSIONS.has(ext)) return 'ts'
  if (JS_EXTENSIONS.has(ext)) return 'js'
  if (CODE_EXTENSIONS.has(ext)) return 'code'
  return 'file'
}

/** Two-letter language badge: an outlined tile with the abbreviation centered. */
function badge(label: string, size: number, className: string | undefined): ReactNode {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2" y="3" width="12" height="10" rx="2" stroke="currentColor" strokeWidth="1.4" />
      <text
        x="8"
        y="10.7"
        textAnchor="middle"
        fontSize="6"
        fontWeight="600"
        fontFamily="inherit"
        fill="currentColor"
      >
        {label}
      </text>
    </svg>
  )
}

/**
 * Render the glyph identifying one file type domain.
 * @param props - Icon kind (see {@link fileTypeIconKind}), optional size, and optional CSS class.
 * @returns The corresponding current-color SVG glyph.
 */
export function FileTypeIcon({ kind, size = 16, className }: {
  kind: FileTypeIconKind
  size?: number
  className?: string | undefined
}): ReactNode {
  switch (kind) {
    case 'file': return <IconBrowseOutline16 size={size} className={className} />
    case 'code': return <IconCodeOutline16 size={size} className={className} />
    case 'image':
      return (
        <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" aria-hidden>
          <rect x="2" y="3" width="12" height="10" rx="2" stroke="currentColor" strokeWidth="1.4" />
          <circle cx="5.75" cy="6.25" r="1.15" fill="currentColor" />
          <path
            d="M3.5 11.5L6.5 8L9 10.75L10.75 8.75L12.5 11.5"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )
    case 'js': return badge('JS', size, className)
    case 'ts': return badge('TS', size, className)
    case 'py': return badge('PY', size, className)
  }
}
