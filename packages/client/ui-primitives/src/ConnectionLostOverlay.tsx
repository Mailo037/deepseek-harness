// ConnectionLostOverlay: full-screen splash overlay surfacing server connection loss.
// Matches the visual language of the boot/splash screen with wordmark, spinner,
// and reconnecting status message.

import { memo } from 'react'
import css from './ConnectionLostOverlay.module.css'

export interface ConnectionLostOverlayProps {
  /** True while the connection is in backoff/retry. */
  reconnecting: boolean
  /** Label copy; defaults to standard reconnecting message. */
  label?: string | undefined
}

/**
 * Full-screen splash overlay shown when connection to the server is lost.
 * Matches the initial boot page wordmark and spinner design.
 */
export const ConnectionLostOverlay = memo(function ConnectionLostOverlay({
  reconnecting,
  label = 'Connection lost. Trying to connect to server…',
}: ConnectionLostOverlayProps) {
  if (!reconnecting) return null
  return (
    <div className={css.overlay} role="status" aria-live="polite" data-connection-lost="">
      <div className={css.card}>
        <div className={css.wordmark}>HARNESS</div>
        <div className={css.spinner} data-boot-spinner="" />
        <div className={css.hint}>{label}</div>
      </div>
    </div>
  )
})
