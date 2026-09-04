import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { removeFixtureSafely } from './test-fixture-cleanup.ts'

const fixtures: string[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) removeFixtureSafely(fixture)
})

function runWeb(args: string[], failBuild = false) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-dev-startup-'))
  fixtures.push(root)
  // Copy the source entry to isolate package-manager calls from the checkout's artifacts.
  copyFileSync(new URL('./dsh-dev.mjs', import.meta.url), join(root, 'dsh-dev.mjs'))
  const execa = join(root, 'node_modules', 'execa')
  mkdirSync(execa, { recursive: true })
  writeFileSync(join(execa, 'package.json'), JSON.stringify({ type: 'module', exports: './index.js' }))
  writeFileSync(join(execa, 'index.js'), `
import { appendFileSync } from 'node:fs'
export async function execa(command, args) {
  appendFileSync('calls.jsonl', JSON.stringify({ command, args }) + '\\n')
  if (args[0] === 'build' && process.env.DSH_TEST_FAIL_BUILD === '1') {
    throw new Error('fixture build failed')
  }
}
`)
  const result = spawnSync(process.execPath, ['dsh-dev.mjs', 'web', ...args], {
    cwd: root,
    env: { ...process.env, DSH_TEST_FAIL_BUILD: failBuild ? '1' : '0' },
    encoding: 'utf8',
    timeout: 10_000,
  })
  const calls = readFileSync(join(root, 'calls.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line) as unknown)
  return { result, calls }
}

it.each([{ flags: [] }, { flags: ['--full'] }])('builds all artifacts before serving with helper flags $flags', ({ flags }) => {
  const { result, calls } = runWeb([...flags, '--trusted-host', '192.168.1.5', '--', '--port', '3081', '--no-open'])
  expect(result.status, result.stderr).toBe(0)
  expect(calls).toEqual([
    { command: 'pnpm', args: ['build'] },
    { command: 'pnpm', args: ['dsh', '--profile', 'web', '--trusted-host', '192.168.1.5', '--port', '3081', '--no-open'] },
  ])
})

it('does not start the host when the prerequisite build fails', () => {
  const { result, calls } = runWeb(['--trusted-host', '192.168.1.5'], true)
  expect(result.status).toBe(1)
  expect(result.stderr).toContain('fixture build failed')
  expect(calls).toEqual([{ command: 'pnpm', args: ['build'] }])
})
