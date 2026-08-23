// ConnectionLostOverlay: delayed full-screen splash overlay for sustained server
// connection loss. The grace period suppresses flashes during brief reconnects.

import { memo, useEffect, useState } from 'react'
import css from './ConnectionLostOverlay.module.css'

const RECONNECT_OVERLAY_DELAY_MS = 1_000

export interface ConnectionLostOverlayProps {
  /** True while the connection is in backoff/retry; the overlay appears after one continuous second. */
  reconnecting: boolean
  /** Label copy; defaults to standard reconnecting message. */
  label?: string | undefined
}

/**
 * Full-screen splash overlay shown after one continuous second without a server connection.
 * Recovery hides it immediately, including before the grace period expires.
 */
export const ConnectionLostOverlay = memo(function ConnectionLostOverlay({
  reconnecting,
  label = 'Connection lost. Trying to connect to server…',
}: ConnectionLostOverlayProps) {
  if (!reconnecting) return null

  return <DelayedConnectionLostOverlay label={label} />
})

function DelayedConnectionLostOverlay({ label }: { label: string }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const timeout = window.setTimeout(() => { setVisible(true) }, RECONNECT_OVERLAY_DELAY_MS)
    return () => { window.clearTimeout(timeout) }
  }, [])

  if (!visible) return null
  return (
    <div className={css.overlay} role="status" aria-live="polite" data-connection-lost="">
      <div className={css.card}>
        <div className={css.wordmark}>HARNESS</div>
        <div className={css.spinner} data-boot-spinner="" />
        <div className={css.hint}>{label}</div>
      </div>
    </div>
  )
}
