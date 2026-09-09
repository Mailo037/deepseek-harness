/**
 * Launch-at-login preference row registered into the General section item
 * slot. The row appears only where the Host serves the `ui-launch` namespace
 * (an Electron deployment with a launch backend); the switch follows the
 * persisted preference.
 */
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { createLaunchRowStore } from './store.ts'
import css from './LaunchRow.module.css'

/** Injected business face: the switch write (t rides the standard locale seat). */
export interface LaunchRowInjected {
  /** Switch launch-at-computer-start. */
  setLaunchAtLogin: (launchAtLogin: boolean) => void
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type LaunchRowComponentProps =
  PropsRuntime<'settings.general.item'> & PropsStore<ReturnType<typeof createLaunchRowStore>>
  & PropsLocale<'settings.launch'> & LaunchRowInjected

/**
 * Render the launch-at-login row. Nothing renders while the Host does not
 * serve the `ui-launch` namespace — a switch without a backend would lie.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export function LaunchRow({ t, useStore, setLaunchAtLogin }: LaunchRowComponentProps) {
  const state = useStore(s => s)
  if (!state.available) return null
  return (
    <div className={css.group}>
      <div className={css.head}>
        <span className={css.title}>{t('launch.title')}</span>
        <button
          type="button"
          role="switch"
          aria-checked={state.launchAtLogin}
          aria-label={t('launch.enable')}
          className={css.switch}
          onClick={() => { setLaunchAtLogin(!state.launchAtLogin) }}
        />
      </div>
      <p className={css.hint}>{t('launch.hint')}</p>
    </div>
  )
}
