/** Interactive deletion of chat data or the complete Harness home. */

import { rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { parse, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

type ResetMode = 'chats' | 'everything'

interface ResetOptions {
  home?: string
  question?: (prompt: string) => Promise<string>
  write?: (text: string) => void
  remove?: (path: string) => Promise<void>
}

const CHAT_DIRECTORIES = ['sessions', 'attachments', 'storages'] as const

/** Compare absolute paths with Windows' case-insensitive filesystem spelling. */
function pathKey(path: string): string {
  const absolute = resolve(path)
  /* v8 ignore next -- each platform executes only its filesystem case rule */
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute
}

/** Reject broad locations that must never be treated as a disposable Harness home. */
function assertSafeHome(home: string): void {
  const key = pathKey(home)
  const forbidden = new Map([
    [pathKey(parse(home).root), 'a filesystem root'],
    [pathKey(homedir()), 'the user home directory'],
    [pathKey(process.cwd()), 'the current working directory'],
  ])
  const reason = forbidden.get(key)
  if (reason !== undefined) {
    throw new Error(`dsh reset: refusing to reset ${reason}: ${home}`)
  }
}

/** Resolve the exact paths owned by one reset mode. */
function resetTargets(home: string, mode: ResetMode): readonly string[] {
  if (mode === 'everything') return [home]
  return CHAT_DIRECTORIES.map(name => resolve(home, name))
}

/** Accept common English and German affirmative answers. */
function confirmed(answer: string): boolean {
  return ['y', 'yes', 'j', 'ja'].includes(answer.trim().toLowerCase())
}

/**
 * Prompt once for reset scope and once for confirmation, then remove only the
 * selected Harness-home data.
 *
 * @param options - Optional path, prompt, output, and deletion adapters for tests.
 * @returns Whether data was deleted; cancellation returns `false`.
 */
export async function runReset(options: ResetOptions = {}): Promise<boolean> {
  const home = resolveDshHome(options.home)
  assertSafeHome(home)
  const output = options.write ?? ((text) => { process.stdout.write(text) })
  const remove = options.remove ?? (path => rm(path, { recursive: true, force: true }))
  let question = options.question
  let close = (): void => {}
  if (question === undefined) {
    const readline = createInterface({ input: process.stdin, output: process.stdout })
    question = prompt => readline.question(prompt)
    close = () => { readline.close() }
  }

  try {
    output(`\nDeepSeek Harness reset\n$DSH_HOME: ${home}\n\n`)
    output('  1) Delete chats only (sessions, attachments, workspace/chat metadata)\n')
    output('     Keeps models, API credentials, settings, profiles, and skills.\n')
    output('  2) Delete everything under $DSH_HOME\n')
    output('  3) Cancel\n\n')

    const selection = (await question('Choose an option [1-3]: ')).trim()
    if (selection === '3' || selection === '') {
      output('Reset cancelled. Nothing was deleted.\n')
      return false
    }
    const mode: ResetMode = selection === '1'
      ? 'chats'
      : selection === '2'
        ? 'everything'
        : (() => { throw new Error(`dsh reset: invalid option ${JSON.stringify(selection)}`) })()

    if (mode === 'chats') {
      output('\nThis deletes every chat, attachment, feedback item, and workspace chat list.\n')
      output('Model settings, API credentials, profiles, and skills stay intact.\n')
    } else {
      output(`\nThis permanently deletes the complete Harness home: ${home}\n`)
    }
    const answer = await question('Continue? [y/N]: ')
    if (!confirmed(answer)) {
      output('Reset cancelled. Nothing was deleted.\n')
      return false
    }

    for (const target of resetTargets(home, mode)) await remove(target)
    output(mode === 'chats'
      ? 'Chat data deleted. Settings and API credentials were preserved.\n'
      : 'All DeepSeek Harness user data deleted.\n')
    return true
  } finally {
    close()
  }
}
