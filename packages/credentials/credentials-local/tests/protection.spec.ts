import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { LocalCredentialProvider } from '../src/index.ts'
import { decodeCredentialText, resolveCredentialProtection } from '../src/protection.ts'

const KEY = credentialRef('DSH_PROTECTED_KEY')
const OTHER = credentialRef('DSH_PROTECTED_OTHER')
const SECRET = 'sk-protection-regression-secret'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!()
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-credentials-protection-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

async function boot(path: string, protection: 'platform' | 'plain' = 'platform'): Promise<Context> {
  const ctx = new Context()
  const fiber = ctx.plugin(LocalCredentialProvider, { path, watch: false, protection })
  cleanups.push(async () => { await fiber.dispose() })
  await fiber
  return ctx
}

describe('platform protection selection', () => {
  it('selects user-scoped DPAPI only on Windows', () => {
    expect(resolveCredentialProtection('platform', 'win32')).toBe('windows-dpapi-user')
    expect(resolveCredentialProtection('platform', 'linux')).toBe('plain')
    expect(resolveCredentialProtection('platform', 'darwin')).toBe('plain')
    expect(resolveCredentialProtection('plain', 'win32')).toBe('plain')
  })
})

describe.runIf(process.platform === 'win32')('Windows DPAPI credential document', () => {
  it('migrates plaintext before activation and survives a protected restart', async () => {
    const dir = await tempDir()
    const path = join(dir, '.credentials.yaml')
    await writeFile(path, `version: 1\nrefs:\n  ${KEY}: ${SECRET}\n`, { mode: 0o600 })

    const first = await boot(path)
    expect(await first.credentials.resolve(KEY)).toEqual({ value: SECRET, source: 'file' })
    const stored = await readFile(path, 'utf8')
    expect(stored).toContain('"method": "windows-dpapi-user"')
    expect(stored).not.toContain(SECRET)
    expect(stored).not.toContain(`${KEY}:`)
    expect(decodeCredentialText(stored, 'windows-dpapi-user', path)).toEqual({
      text: `version: 1\nrefs:\n  ${KEY}: ${SECRET}\n`,
      protected: true,
    })

    const second = await boot(path)
    expect(await second.credentials.resolve(KEY)).toEqual({ value: SECRET, source: 'file' })
  })

  it('stores new values without readable key names or values', async () => {
    const dir = await tempDir()
    const path = join(dir, '.credentials.yaml')
    const ctx = await boot(path)

    await ctx.credentials.set(KEY, SECRET)

    const stored = await readFile(path, 'utf8')
    expect(stored).toContain('"dshCredentialsProtection": 1')
    expect(stored).not.toContain(SECRET)
    expect(stored).not.toContain(KEY)
  })

  it('fails loud when the protected payload is corrupted', async () => {
    const dir = await tempDir()
    const path = join(dir, '.credentials.yaml')
    const ctx = await boot(path)
    await ctx.credentials.set(KEY, SECRET)
    const stored = JSON.parse(await readFile(path, 'utf8')) as { payload: string }
    const first = stored.payload[0]
    stored.payload = `${first === 'A' ? 'B' : 'A'}${stored.payload.slice(1)}`
    await writeFile(path, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 })

    await expect(boot(path)).rejects.toThrow(/CryptUnprotectData failed/)
  })

  it('refuses a plaintext replacement until restart can migrate it under the writer lock', async () => {
    const dir = await tempDir()
    const path = join(dir, '.credentials.yaml')
    const ctx = await boot(path)
    await ctx.credentials.set(KEY, SECRET)
    await writeFile(path, `version: 1\nrefs:\n  ${KEY}: replacement\n`, { mode: 0o600 })

    await expect(ctx.credentials.set(OTHER, 'other')).rejects.toThrow(/plaintext replacement.*restart to migrate/)
    expect(await ctx.credentials.resolve(KEY)).toEqual({ value: SECRET, source: 'file' })

    const restarted = await boot(path)
    expect(await restarted.credentials.resolve(KEY)).toEqual({ value: 'replacement', source: 'file' })
    expect(await readFile(path, 'utf8')).not.toContain('replacement')
  })

  it('does not silently downgrade an existing protected document to plaintext', async () => {
    const dir = await tempDir()
    const path = join(dir, '.credentials.yaml')
    const protectedContext = await boot(path)
    await protectedContext.credentials.set(KEY, SECRET)

    await expect(boot(path, 'plain')).rejects.toThrow(/is protected with windows-dpapi-user.*selected plain/)
  })
})
