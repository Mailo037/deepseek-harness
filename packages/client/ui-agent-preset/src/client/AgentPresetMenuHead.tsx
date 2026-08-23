/**
 * The more-options menu's pinned head: this session's agent-preset name,
 * reported read-only where the header label sits on wide viewports. Visible
 * only on phone-sized viewports — there the header drops its action row, so
 * the menu is the label's home; wide layouts keep the inline label and hide
 * this head to avoid reporting the same fact twice.
 */

import { useEffect, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconAgentPresetOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AgentPresetSettingsState } from './settings-store.ts'
import { presetDisplayText } from './locales.ts'
import css from './AgentPresetMenuHead.module.css'

/** Same business face as the header label: roster snapshot plus loader. */
export type AgentPresetMenuHeadInjected = {
  hooks: {
    /** Roster snapshot bound by the renderer as useAgentPresets. */
    agentPresets: import('@deepseek-ai/dsh-client-runtime/client').SnapshotStore<AgentPresetSettingsState>
  }
  /** Read the roster, so the head can show a name rather than an id. */
  load: () => Promise<void>
}

/** Full component props. */
export type AgentPresetMenuHeadProps =
  PropsRuntime<'conversation.session.header.utilities.menuHead'>
  & PropsLocale<'settings.agentPreset'>
  & InjectFace<AgentPresetMenuHeadInjected>

/**
 * Render this session's agent-preset name as the more-options menu's pinned
 * context row.
 * @param props - composed slot props.
 * @returns the head row, or null when the session records no preset.
 */
export function AgentPresetMenuHead({
  sessionId, useSessions, useAgentPresets, load, t,
}: AgentPresetMenuHeadProps) {
  const preset = useSessions(state => state.byId[sessionId]?.agentPreset)
  const options = useAgentPresets(state => state.options)
  // Phone-gated in JS, not CSS: an occupied-but-hidden head would still pin
  // the Menu's hairline and padding on wide layouts.
  const [phone, setPhone] = useState(
    () => typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 639px)').matches,
  )
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(max-width: 639px)')
    const onChange = (): void => { setPhone(query.matches) }
    query.addEventListener('change', onChange)
    return () => { query.removeEventListener('change', onChange) }
  }, [])

  useEffect(() => {
    if (preset !== undefined) void load()
  }, [preset, load])

  if (preset === undefined || !phone) return null

  const option = options.find(entry => entry.id === preset)
  const text = option === undefined ? undefined : presetDisplayText(option, t)
  return (
    <span className={css.head} title={text?.description ?? t('headerHint')}>
      <IconAgentPresetOutline16 size={14} className={css.icon} />
      {text?.name ?? preset}
    </span>
  )
}
