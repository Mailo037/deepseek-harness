import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { assertFileUnchanged, distributionPaths, fingerprintFile } from '../scripts/package-paths.mjs'

const BUILDER_CONFIG = fileURLToPath(new URL('../electron-builder.yml', import.meta.url))

describe('Electron distribution configuration', () => {
  it('builds a signed-when-credentials-exist NSIS artifact with the web runtime resources', () => {
    const config = readFileSync(BUILDER_CONFIG, 'utf8')

    expect(config).toContain('appId: ai.deepseek.harness')
    expect(config).toContain('productName: DeepSeek Harness')
    expect(config).toContain('target: nsis')
    expect(config).toContain('icon: build/icon.ico')
    expect(config).toContain('lib/types/**')
    expect(config).toContain('config/**')
    expect(config).toContain('verifyUpdateCodeSignature: true')
    expect(config).toContain('provider: github')
    expect(config).toContain('repo: deepseek-harness')
  })

  it('keeps signing credentials out of the checked-in builder configuration', () => {
    const config = readFileSync(BUILDER_CONFIG, 'utf8')

    expect(config).not.toMatch(/(?:CSC|certificate(?:File|Password)|privateKey)/i)
  })

  it('pins packaging below apps/electron and guards the source root package manifest', () => {
    const paths = distributionPaths()
    const sourceHash = fingerprintFile(paths.rootPackageJson)

    expect(paths.output).toMatch(/[\\/]apps[\\/]electron[\\/]release$/)
    // The root manifest is the checkout-level package.json: an ancestor of
    // this app, never inside it — whatever the checkout directory is named.
    const appDir = fileURLToPath(new URL('../', import.meta.url))
    expect(appDir.startsWith(paths.rootPackageJson.slice(0, -'package.json'.length))).toBe(true)
    expect(paths.output).not.toBe(paths.rootPackageJson)
    expect(() => { assertFileUnchanged(paths.rootPackageJson, sourceHash) }).not.toThrow()
    expect(readFileSync(fileURLToPath(new URL('../scripts/package.mjs', import.meta.url)), 'utf8')).toContain("'--projectDir', paths.appRoot")
    expect(readFileSync(fileURLToPath(new URL('../scripts/package.mjs', import.meta.url)), 'utf8')).toContain("'--config.directories.output', paths.output")
  })
})
