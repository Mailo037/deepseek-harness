/**
 * The running installation's version: the nearest `package.json` walking up
 * from this module, which is the dsh app's own manifest version in both the
 * source tree (the root workspace manifest) and a built install (the released
 * package manifest). All workspace manifests carry the same version, so the
 * first hit is the honest answer for either layout.
 * @module @deepseek-ai/dsh-host-apiproxy/host-version
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Where the upward manifest search starts: this package's src/ or lib/ directory. */
const START_DIR = fileURLToPath(new URL('..', import.meta.url))

/**
 * Read the installation version once per process.
 * @returns the nearest manifest's `version`, or `'0.0.0'` when no readable
 * manifest exists above this module (an embedding layout without one).
 */
export function readInstallationVersion(): string {
  let dir = START_DIR
  while (true) {
    try {
      const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { version?: unknown }
      if (typeof manifest.version === 'string') return manifest.version
    } catch {
      // No manifest (or an unreadable one) at this level: keep walking up.
    }
    const parent = dirname(dir)
    if (parent === dir) return '0.0.0'
    dir = parent
  }
}
