// Select: token-styled custom dropdown atom. Replaces native <select>
// with accessible, theme-consistent trigger and Menu dropdown.

import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import { IconChevronDownOutline14 } from './icons/index.tsx'
import { Menu, type MenuItem } from './Menu.tsx'
import css from './Select.module.css'

/** One selectable option in the dropdown list. */
export interface SelectOption {
  value: string
  label: ReactNode
  disabled?: boolean | undefined
  icon?: ReactNode | undefined
}

/** Props for the Select dropdown atom. */
export interface SelectProps {
  id?: string | undefined
  value?: string | undefined
  options: readonly SelectOption[]
  onChange?: ((value: string) => void) | undefined
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
}

/**
 * Render a token-styled dropdown select.
 * @param props.value - current selected value.
 * @param props.options - selectable options with value and label.
 * @param props.onChange - callback when an option is selected.
 * @param props.placeholder - text when nothing is selected.
 * @param props.disabled - whether the selector is disabled.
 * @param props.invalid - whether the selector is in an error/invalid state.
 * @param props.size - 'md' standard (32px) or 'sm' compact (26px).
 * @param props.portal - whether to render the menu in document.body (default true).
 * @returns dropdown select trigger and menu.
 */
export function Select({
  id,
  value,
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
}: SelectProps) {
  const [open, setOpen] = useState(false)
  const autoId = useId()
  const triggerId = id ?? autoId

  const selectedOption = options.find(option => option.value === value)
  const displayLabel = selectedOption?.label ?? (value !== undefined && value !== '' ? value : null)
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
        selectedId={value}
        dense={size === 'sm'}
        compact={size === 'sm'}
        className={css.menu}
        onClose={() => { setOpen(false) }}
        onSelect={(selectedId) => {
          setOpen(false)
          onChange?.(selectedId)
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
