/**
 * A settings/sub-page heading: a bold title over an optional description.
 * Settings sections share one heading treatment so switching tabs never changes
 * the title-and-description rhythm.
 */
import type { ReactNode } from 'react'
import css from './SectionHeading.module.css'

/** Props for a heading block (title plus optional description). */
export interface SectionHeadingProps {
  /** Visible and accessible heading text. */
  title: ReactNode
  /** Optional one-line description under the title. */
  description?: ReactNode | undefined
}

/** Render a title and its optional description as one heading block. */
export function SectionHeading({ title, description }: SectionHeadingProps): ReactNode {
  return (
    <div className={css.heading}>
      <h2 className={css.title}>{title}</h2>
      {description === undefined ? null : <p className={css.description}>{description}</p>}
    </div>
  )
}
