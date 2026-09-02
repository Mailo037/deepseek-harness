import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, parse } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runReset } from '../src/reset.ts'

const roots: string[] = []

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-reset-'))
  roots.push(root)
  for (const path of [
    'sessions/chat/session.jsonl',
    'attachments/v1/image',
    'storages/workspace.json',
    'profiles/web/cordis.patch.yml',
    'skills/example/SKILL.md',
  ]) {
    const file = join(root, path)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, path)
  }
  await writeFile(join(root, 'settings.yaml'), 'models: kept\n')
  await writeFile(join(root, '.credentials.yaml'), 'protected: kept\n')
  return root
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false)
}

function answers(...values: string[]): (prompt: string) => Promise<string> {
  return async () => values.shift() ?? ''
}

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('dsh reset', () => {
  it('deletes chat data while preserving settings, credentials, profiles, and skills', async () => {
    const home = await fixture()
    const output: string[] = []

    await expect(runReset({ home, question: answers('1', 'yes'), write: text => output.push(text) }))
      .resolves.toBe(true)

    await expect(exists(join(home, 'sessions'))).resolves.toBe(false)
    await expect(exists(join(home, 'attachments'))).resolves.toBe(false)
    await expect(exists(join(home, 'storages'))).resolves.toBe(false)
    await expect(exists(join(home, 'settings.yaml'))).resolves.toBe(true)
    await expect(exists(join(home, '.credentials.yaml'))).resolves.toBe(true)
    await expect(exists(join(home, 'profiles/web/cordis.patch.yml'))).resolves.toBe(true)
    await expect(exists(join(home, 'skills/example/SKILL.md'))).resolves.toBe(true)
    expect(output.join('')).toContain('Settings and API credentials were preserved.')
  })

  it('deletes the complete Harness home after confirmation', async () => {
    const home = await fixture()

    await expect(runReset({ home, question: answers('2', 'j'), write: () => {} })).resolves.toBe(true)
    await expect(exists(home)).resolves.toBe(false)
  })

  it('cancels without deleting when confirmation is absent', async () => {
    const home = await fixture()

    await expect(runReset({ home, question: answers('1', 'no'), write: () => {} })).resolves.toBe(false)
    await expect(exists(join(home, 'sessions/chat/session.jsonl'))).resolves.toBe(true)
    await expect(exists(join(home, 'settings.yaml'))).resolves.toBe(true)
  })

  it('cancels at the scope prompt without deleting', async () => {
    for (const selection of ['3', '']) {
      const home = await fixture()
      await expect(runReset({ home, question: answers(selection), write: () => {} })).resolves.toBe(false)
      await expect(exists(join(home, 'sessions/chat/session.jsonl'))).resolves.toBe(true)
    }
  })

  it('uses the process streams and DSH_HOME in the source command path', async () => {
    const home = await fixture()
    vi.stubEnv('DSH_HOME', home)
    const input = new PassThrough()
    vi.spyOn(process, 'stdin', 'get').mockReturnValue(input as unknown as typeof process.stdin)
    const output: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      const text = String(chunk)
      output.push(text)
      if (text.includes('Continue?')) setImmediate(() => { input.write('y\n') })
      return true
    })

    const reset = runReset()
    input.write('1\n')
    await expect(reset).resolves.toBe(true)
    input.end()
    await expect(exists(join(home, 'sessions'))).resolves.toBe(false)
    expect(output.join('')).toContain('Chat data deleted.')
  })

  it('rejects invalid choices and unsafe broad homes without deleting', async () => {
    const home = await fixture()
    await expect(runReset({ home, question: answers('4'), write: () => {} }))
      .rejects.toThrow('invalid option')
    await expect(exists(join(home, 'sessions/chat/session.jsonl'))).resolves.toBe(true)

    await expect(runReset({ home: homedir(), question: answers('2', 'yes'), write: () => {} }))
      .rejects.toThrow('user home directory')
    await expect(runReset({ home: parse(home).root, question: answers('2', 'yes'), write: () => {} }))
      .rejects.toThrow('filesystem root')
    await expect(runReset({ home: process.cwd(), question: answers('2', 'yes'), write: () => {} }))
      .rejects.toThrow('current working directory')
  })
})
