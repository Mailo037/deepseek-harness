/**
 * The per-model modality override dialog, shared by both adapter editors, and
 * the modality badges that the row panels and the fetch dialog render. Editing
 * modalities stores a custom override in place of the catalog value, and the
 * dialog says so before the user commits one: a model that cannot handle the
 * chosen modality fails those requests at call time.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button, IconWarningOutline16, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/** Localized modality name, or the raw value for one this copy does not name. */
function modalityName(modality: string, t: (key: keyof typeof en) => string): string {
  return modality === 'text'
    ? t('modalityText')
    : modality === 'image'
      ? t('modalityImage')
      : modality === 'video' ? t('modalityVideo') : modality
}

/**
 * The modality badges of one model, with the inferred-vision hint — shared by
 * the row panels and the fetch dialog so both surfaces spell modalities one
 * way.
 */
export function ModalityBadges({ info, t }: {
  info: {
    inputModalities?: readonly string[] | undefined
    visionInferred?: boolean | undefined
  }
  t: (key: keyof typeof en) => string
}): ReactNode {
  return (
    <span className={styles['modelBadges']}>
      {(info.inputModalities ?? []).map(mod => (
        <span key={mod} className={styles['modalityBadge']}>
          {modalityName(mod, t)}
        </span>
      ))}
      {info.visionInferred === true && info.inputModalities?.includes('image') ? (
        <span className={styles['modalityHint']}>{t('modalityVisionInferredHint')}</span>
      ) : null}
    </span>
  )
}

/** Props of {@link ModelModalityDialog}. */
export interface ModelModalityDialogProps {
  /** The modality values the editing adapter accepts, in display order. */
  choices: readonly string[]
  /** The modalities the row effectively answers with before this edit. */
  selected: readonly string[]
  /** Whether applying an empty selection is meaningful — the pi-ai inherit path. */
  allowEmpty: boolean
  /** Section copy. */
  t: (key: keyof typeof en) => string
  /** Apply the chosen list in {@link ModelModalityDialogProps.choices} order. */
  onApply: (next: string[]) => void
  /** Close without changing anything. */
  onClose: () => void
}

/**
 * Render the modality override dialog: the custom-override warning first, the
 * modality checkboxes, and the hint that says what an empty selection means
 * for this adapter.
 * @param props - the adapter's choices, the row's current modalities, and the
 *   two actions.
 * @returns the dialog; mounted only while a row is being edited.
 */
export function ModelModalityDialog(props: ModelModalityDialogProps): ReactNode {
  // Fresh on every mount: the parent renders the dialog only while a row is
  // open, so the initial selection is that row's.
  const [picked, setPicked] = useState<ReadonlySet<string>>(
    () => new Set(props.choices.filter(choice => props.selected.includes(choice))),
  )

  const toggle = (choice: string): void => {
    setPicked((current) => {
      const next = new Set(current)
      if (!next.delete(choice)) next.add(choice)
      return next
    })
  }

  const apply = (): void => {
    props.onApply(props.choices.filter(choice => picked.has(choice)))
  }

  return (
    <Modal
      open
      onClose={props.onClose}
      title={props.t('modalityDialogTitle')}
      closeLabel={props.t('close')}
      className={styles['modalityDialog'] as string}
      footer={(
        <>
          <Button variant="outline" onClick={props.onClose}>{props.t('cancel')}</Button>
          <Button
            variant="outline"
            disabled={picked.size === 0 && !props.allowEmpty}
            onClick={apply}
          >
            {props.t('apply')}
          </Button>
        </>
      )}
    >
      <p className={styles['modalityWarning']}>
        <IconWarningOutline16 size={14} />
        {props.t('modalityWarning')}
      </p>
      <ul className={styles['modalityChoices']}>
        {props.choices.map(choice => (
          <li key={choice} className={styles['modalityChoice']}>
            <label className={styles['modalityChoiceLabel']}>
              <input
                type="checkbox"
                checked={picked.has(choice)}
                onChange={() => { toggle(choice) }}
              />
              <span className={styles['modalityBadge']}>{modalityName(choice, props.t)}</span>
            </label>
          </li>
        ))}
      </ul>
      <p className={styles['modalityHint']}>
        {props.allowEmpty ? props.t('modalityInheritHint') : props.t('modalityRequiredHint')}
      </p>
    </Modal>
  )
}
