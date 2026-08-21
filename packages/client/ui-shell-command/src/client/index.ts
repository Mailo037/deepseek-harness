/**
 * Browser plugin for `!` shell commands: registers the adjudication-only `!`
 * input-trigger source, the durable shell-command Conversation Node, and its
 * keyed terminal-card renderer.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-shell-command/remote'
import type {} from '@deepseek-ai/dsh-shell-command/types'
import { ShellCommandCard } from './ShellCommandCard.tsx'
import { NS, en, type ShellCommandKey, zh } from './locales.ts'
import { shellCommandDefinition } from './shell-command-node.ts'
import { ShellCommandSource } from './source.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Shell-command card and source copy. */
    shellCommand: ShellCommandKey
  }
}

/** Required services: node registry, slot registry, locale, the trigger pipeline, and the host remote. */
export const inject = ['conversationEvents', 'slots', 'locale', 'inputTriggers', 'remote', 'remote.shellCommand']

/**
 * Register the Definition, dictionary, source, and keyed Chat renderer.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  ctx.conversationEvents.register(shellCommandDefinition)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-shell-command: dictionaries')
  const locale = ctx.get('locale')
  if (locale === undefined) throw new Error('ui-shell-command: locale service unavailable')
  const source = new ShellCommandSource(ctx, locale.bind(NS))
  ctx.effect(() => ctx.inputTriggers.registerSource(source), 'ui-shell-command: ! source')
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'shell-command',
    locale: NS,
  }, ShellCommandCard))
}
