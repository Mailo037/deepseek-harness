// MultiSelect: token-styled multi-select dropdown atom.
// Wraps Menu with multi-selection support (selectedIds) and customizable trigger summary.

import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import { IconChevronDownOutline14 } from './icons/index.tsx'
import { Menu, type MenuItem } from './Menu.tsx'
import type { SelectOption } from './Select.tsx'
import css from './Select.module.css'

/** Props for the MultiSelect dropdown atom. */
export interface MultiSelectProps {
  id?: string | undefined
  values: readonly string[]
  options: readonly SelectOption[]
  onChange?: ((values: string[]) => void) | undefined
  placeholder?: string | undefined
  disabled?: boolean | undefined
  invalid?: boolean | undefined
  size?: 'md' | 'sm' | undefined
  portal?: boolean | undefined
  align?: 'start' | 'end' | undefined
  side?: 'bottom' | 'top' | 'right' | undefined
  className?: string | undefined
  triggerClassName?: string | undefined
  'aria-label'?: string | undefined
  'aria-labelledby'?: string | undefined
  'aria-describedby'?: string | undefined
  renderSummary?: ((selectedValues: readonly string[], options: readonly SelectOption[]) => ReactNode) | undefined
}

/**
 * Render a token-styled multi-select dropdown.
 * @param props.values - currently selected option values.
 * @param props.options - selectable options with value and label.
 * @param props.onChange - callback when options are toggled.
 * @param props.placeholder - text when nothing is selected.
 * @param props.disabled - whether the selector is disabled.
 * @param props.invalid - whether the selector is in an error/invalid state.
 * @param props.size - 'md' standard (32px) or 'sm' compact (26px).
 * @param props.portal - whether to render the menu in document.body (default true).
 * @param props.renderSummary - custom renderer for the trigger label.
 * @returns multi-select dropdown trigger and menu.
 */
export function MultiSelect({
  id,
  values,
  options,
  onChange,
  placeholder,
  disabled = false,
  invalid = false,
  size = 'md',
  portal = true,
  align = 'start',
  side = 'bottom',
  className,
  triggerClassName,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  renderSummary,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false)
  const autoId = useId()
  const triggerId = id ?? autoId

  let displayLabel: ReactNode = null
  if (renderSummary !== undefined) {
    displayLabel = renderSummary(values, options)
  } else if (values.length === 0) {
    displayLabel = null
  } else if (values.length === 1) {
    const opt = options.find(o => o.value === values[0])
    displayLabel = opt?.label ?? values[0]
  } else {
    displayLabel = `${values.length} selected`
  }

  const isPlaceholder = displayLabel === null && placeholder !== undefined

  const menuItems = options.map((option): MenuItem => ({
    id: option.value,
    label: option.label,
    ...(option.disabled !== undefined ? { disabled: option.disabled } : {}),
    ...(option.icon !== undefined ? { icon: option.icon } : {}),
  }))

  return (
    <div className={clsx(css.root, className)}>
      <Menu
        open={open}
        portal={portal}
        align={align}
        side={side}
        items={menuItems}
        selectedIds={values}
        dense={size === 'sm'}
        compact={size === 'sm'}
        className={css.menu}
        onClose={() => { setOpen(false) }}
        onSelect={(selectedId) => {
          const next = values.includes(selectedId)
            ? values.filter(v => v !== selectedId)
            : [...values, selectedId]
          onChange?.(next)
        }}
        anchor={(
          <button
            id={triggerId}
            type="button"
            role="combobox"
            aria-expanded={open}
            aria-haspopup="menu"
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledBy}
            aria-describedby={ariaDescribedBy}
            aria-invalid={invalid ? true : undefined}
            disabled={disabled}
            className={clsx(
              css.trigger,
              css[size],
              invalid && css.invalid,
              triggerClassName,
            )}
            onClick={() => { setOpen(prev => !prev) }}
          >
            <span className={clsx(css.label, isPlaceholder && css.placeholder)}>
              {displayLabel ?? placeholder ?? ''}
            </span>
            <span className={clsx(css.chevron, open && css.chevronOpen)} aria-hidden>
              <IconChevronDownOutline14 />
            </span>
          </button>
        )}
      />
    </div>
  )
}
