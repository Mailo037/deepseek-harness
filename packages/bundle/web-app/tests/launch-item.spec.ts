/** The web surface's Windows Run-key launch backend: registration command
 * shape, unregister idempotence, platform gating, and the plugin provide. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, createWindowsRunKeyBackend, type RegistryRun } from '../src/launch-item.ts'

const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
const VALUE_NAME = 'DeepSeekHarness'

function recorded(): RegistryRun & { calls: Array<{ file: string; args: readonly string[] }> } {
  const calls: Array<{ file: string; args: readonly string[] }> = []
  const run: RegistryRun = (file, args) => { calls.push({ file, args }) }
  return Object.assign(run, { calls })
}

const originalPlatform = process.platform

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
})

function withPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

describe('createWindowsRunKeyBackend', () => {
  it('registers a Run-key command that relaunches the web host from the checkout', () => {
    const run = recorded()
    const backend = createWindowsRunKeyBackend({ platform: 'win32', run, root: 'C:\\repo' })
    expect(backend.supported).toBe(true)
    backend.apply(true)
    expect(run.calls).toEqual([{
      file: 'reg',
      args: ['add', RUN_KEY, '/v', VALUE_NAME, '/t', 'REG_SZ', '/d',
        'cmd.exe /d /s /c "cd /d C:\\repo && pnpm dsh --profile web --no-open"', '/f'],
    }])
  })

  it('unregistering deletes only after the value is observed to exist', () => {
    const run = recorded()
    const backend = createWindowsRunKeyBackend({ platform: 'win32', run, root: 'C:\\repo' })
    backend.apply(false)
    expect(run.calls).toEqual([
      { file: 'reg', args: ['query', RUN_KEY, '/v', VALUE_NAME] },
      { file: 'reg', args: ['delete', RUN_KEY, '/v', VALUE_NAME, '/f'] },
    ])
  })

  it('treats an absent value as already unregistered without a delete', () => {
    const calls: Array<{ file: string; args: readonly string[] }> = []
    let queries = 0
    const run: RegistryRun = (file, args) => {
      if (args[0] === 'query') {
        queries += 1
        throw new Error('reg: unable to find the specified registry key')
      }
      calls.push({ file, args })
    }
    const backend = createWindowsRunKeyBackend({ platform: 'win32', run, root: 'C:\\repo' })
    backend.apply(false)
    expect(queries).toBe(1)
    expect(calls).toEqual([])
  })

  it('is unsupported off Windows and never touches the registry there', () => {
    const run = recorded()
    const backend = createWindowsRunKeyBackend({ platform: 'linux', run })
    expect(backend.supported).toBe(false)
    backend.apply(true)
    expect(run.calls).toEqual([])
  })
})

describe('web-launch-item plugin', () => {
  it('provides the backend on Windows and nothing elsewhere', () => {
    withPlatform('win32')
    const winCtx = new Context()
    apply(winCtx)
    expect(winCtx.get('launchSettings')).toBeDefined()

    withPlatform('darwin')
    const macCtx = new Context()
    apply(macCtx)
    expect(macCtx.get('launchSettings')).toBeUndefined()
  })

  it('the composed web bundle mounts the launch backend row', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const patch = readFileSync(fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)), 'utf8')
    expect(patch).toContain("name: '@deepseek-ai/dsh-web-app/launch-item'")
  })
})
