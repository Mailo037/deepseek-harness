import { memo } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { TerminalBlock, type TerminalBlockLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ShellCommandChatData } from './shell-command-node.ts'
import css from './ShellCommandCard.module.css'

/** Complete keyed Chat renderer props. */
export type ShellCommandCardProps =
  PropsRuntime<'conversation.chat.node', 'shell-command'>
  & PropsLocale<'shellCommand'>

/**
 * Render one durable shell command as a terminal block: prompt row with the
 * run-state dot and cwd, ANSI-colored output, and the exit-status pill.
 * @param props - the node view props; `node.data` is the folded lifecycle.
 * @returns the terminal card element.
 */
export const ShellCommandCard = memo(function ShellCommandCard({ node, t }: ShellCommandCardProps) {
  const data = node.data as ShellCommandChatData
  const labels: Partial<TerminalBlockLabels> = {
    signal: signal => t('terminal.signal', { signal }),
    exitCode: code => t('terminal.exitCode', { code }),
    running: t('terminal.running'),
    failed: t('terminal.failed'),
    done: t('terminal.done'),
    noOutput: t('terminal.noOutput'),
    collapseAria: t('terminal.collapseAria'),
    expandAria: hidden => t('terminal.expandAria', { n: hidden }),
    expand: hidden => t('terminal.expandRest', { n: hidden }),
  }
  return (
    <div className={css.row}>
      <TerminalBlock
        command={data.command}
        cwd={data.cwd}
        output={data.outcome?.output.text}
        exitCode={data.outcome?.exitCode ?? undefined}
        signal={data.outcome?.signal ?? undefined}
        running={data.outcome === null}
        labels={labels}
      />
    </div>
  )
})
