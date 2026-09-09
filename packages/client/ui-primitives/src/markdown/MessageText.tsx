// Literal user text keeps its formatting; only links opt into token presentation.
import type { ReactNode } from 'react'
import { LinkToken, LinkTitleContext } from './LinkToken.tsx'
import css from './MessageText.module.css'

export function MessageText({ text, linkTokens = false, resolveLinkTitle }: {
  text: string
  linkTokens?: boolean
  resolveLinkTitle?: ((url: string) => Promise<string | null>) | undefined
}) {
  const parts: ReactNode[] = []
  let cursor = 0
  if (linkTokens) {
    const pattern = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|https?:\/\/[^\s<>"`]+/gu
    for (const match of text.matchAll(pattern)) {
      const raw = match[0]
      const href = match[2] ?? raw.replace(/[.,;:!?)}\]]+$/gu, '')
      try { new URL(href) } catch { continue /* Incomplete URLs stay literal during editing. */ }
      parts.push(text.slice(cursor, match.index))
      parts.push(<LinkToken key={match.index} href={href}>{match[1] ?? href}</LinkToken>)
      const consumed = match[2] === undefined ? href.length : raw.length
      cursor = match.index + consumed
    }
  }
  parts.push(text.slice(cursor))
  return <LinkTitleContext.Provider value={resolveLinkTitle}><div className={css.text}>{parts}</div></LinkTitleContext.Provider>
}
