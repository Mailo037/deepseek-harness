import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))

/** Return the fixed paths that an Electron distribution build may use. */
export function distributionPaths() {
  const appRoot = resolve(SCRIPT_DIR, '..')
  const repositoryRoot = resolve(appRoot, '..', '..')
  return {
    appRoot,
    builderConfig: resolve(appRoot, 'electron-builder.yml'),
    output: resolve(appRoot, 'release'),
    rootPackageJson: resolve(repositoryRoot, 'package.json'),
  }
}

/** Reject an output path that escapes the Electron app directory. */
export function assertAppOutputPath(appRoot, output) {
  const pathFromApp = relative(appRoot, output)
  if (pathFromApp === '' || pathFromApp.startsWith('..') || pathFromApp.includes(':')) {
    throw new Error(`Electron distribution output must be below the app directory: ${output}`)
  }
}

/** Hash a source file so a packaging subprocess cannot silently overwrite it. */
export function fingerprintFile(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

/** Assert that a source file has exactly the expected pre-build bytes. */
export function assertFileUnchanged(file, expectedHash) {
  const actualHash = fingerprintFile(file)
  if (actualHash !== expectedHash) {
    throw new Error(`Electron packaging unexpectedly modified source file: ${file}`)
  }
}
