import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { FileTypeIcon, fileTypeIconKind } from '../FileTypeIcon.tsx'
import { IconLinkOutline16 } from '../icons/index.tsx'
import css from './LinkToken.module.css'

/** Optional host title lookup shared by the literal and Markdown renderers. */
export const LinkTitleContext = createContext<((url: string) => Promise<string | null>) | undefined>(undefined)

/** Compact HTTP(S) link with a site title or a file basename and type glyph. */
export function LinkToken({ href, children }: { href: string; children?: ReactNode }) {
  const resolveTitle = useContext(LinkTitleContext)
  const url = new URL(href)
  let filename = url.pathname.split('/').at(-1) ?? ''
  try { filename = decodeURIComponent(filename) } catch { /* Malformed percent escapes retain the literal filename. */ }
  const kind = fileTypeIconKind(filename)
  const isFile = kind !== 'file' && !/\.html?$/iu.test(filename)
    || /\.(?:txt|md|csv|xlsx?|docx?|pptx?|zip|tar|gz|7z|log)$/iu.test(filename)
  const [metadata, setMetadata] = useState<{ href: string; title: string } | null>(null)
  const [icon, setIcon] = useState<{ origin: string; status: 'loaded' | 'failed' } | null>(null)
  const iconStatus = icon?.origin === url.origin ? icon.status : 'loading'
  useEffect(() => {
    if (isFile || resolveTitle === undefined) return
    let active = true
    void resolveTitle(href).then((title) => {
      if (active && title) {
        const decoder = document.createElement('textarea')
        decoder.innerHTML = title.replace(/</gu, '&lt;')
        setMetadata({ href, title: decoder.value })
      }
    }).catch(() => { /* A failed optional preview keeps its authored label or hostname. */ })
    return () => { active = false }
  }, [href, isFile, resolveTitle])
  const rawLabel = typeof children === 'string' ? children : Array.isArray(children) && children.every(part => typeof part === 'string') ? children.join('') : null
  const label = isFile ? filename : metadata?.href === href ? metadata.title
    : rawLabel === href || rawLabel === url.href || !children ? url.hostname.replace(/^www\./u, '') : children
  return (
    <a href={href} title={href} target="_blank" rel="noopener noreferrer" className={css.token} data-link-token={isFile ? 'file' : 'website'}>
      {isFile ? <FileTypeIcon kind={kind} size={14} className={css.icon} /> : <>
        {iconStatus !== 'failed' && <img src={`${url.origin}/favicon.ico`} alt="" referrerPolicy="no-referrer" loading="lazy" decoding="async"
          className={css.icon} hidden={iconStatus !== 'loaded'}
          onLoad={() => { setIcon({ origin: url.origin, status: 'loaded' }) }}
          onError={() => { setIcon({ origin: url.origin, status: 'failed' }) }} />}
        {iconStatus !== 'loaded' && <IconLinkOutline16 size={14} className={css.icon} />}
      </>}
      <span className={css.label}>{label}</span>
    </a>
  )
}
