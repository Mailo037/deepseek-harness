/** Reusable token-styled card, labelled field, and comparison rail primitives. */

import { useId, type ReactNode } from 'react'
import clsx from 'clsx'
import css from './SurfaceCard.module.css'

/** Props for a compact settings or status card. */
export interface SurfaceCardProps {
  /** Optional stable DOM target for tests and integrations. */
  id?: string | undefined
  /** Visible and accessible card heading. */
  title: ReactNode
  /** Optional status marker aligned with the heading. */
  status?: ReactNode | undefined
  /** Card body. */
  children: ReactNode
  /** Additional card class. */
  className?: string | undefined
}

/** Render a compact titled card whose content controls its own spacing. */
export function SurfaceCard({ id, title, status, children, className }: SurfaceCardProps): ReactNode {
  const titleId = useId()
  return (
    <section id={id} className={clsx(css.card, className)} aria-labelledby={titleId}>
      <div className={css.head}>
        <span id={titleId} className={css.title}>{title}</span>
        {status}
      </div>
      {children}
    </section>
  )
}

/** Props for a label stacked above one custom control or value. */
export interface LabeledFieldProps {
  /** Visible field label. */
  label: ReactNode
  /** Id of an interactive child associated with the label. */
  labelFor?: string | undefined
  /** Custom control or read-only field value. */
  children: ReactNode
  /** Additional field-stack class. */
  className?: string | undefined
}

/** Render a reusable field stack; `labelFor` connects an interactive child. */
export function LabeledField({ label, labelFor, children, className }: LabeledFieldProps): ReactNode {
  return (
    <div className={clsx(css.field, className)}>
      {labelFor === undefined
        ? <span className={css.fieldLabel}>{label}</span>
        : <label className={css.fieldLabel} htmlFor={labelFor}>{label}</label>}
      {children}
    </div>
  )
}

/** Props for a compact two-endpoint relationship rail. */
export interface ComparisonRailProps {
  /** Left endpoint label. */
  from: ReactNode
  /** Right endpoint label. */
  to: ReactNode
  /** Additional comparison-rail class. */
  className?: string | undefined
}

/** Render two labelled endpoints joined by a bidirectional comparison line. */
export function ComparisonRail({ from, to, className }: ComparisonRailProps): ReactNode {
  return (
    <div className={clsx(css.rail, className)} aria-hidden="true">
      <span className={css.node}>{from}</span>
      <span className={css.line}>↔</span>
      <span className={css.node}>{to}</span>
    </div>
  )
}
