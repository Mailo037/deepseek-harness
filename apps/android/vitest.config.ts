import { defineConfig } from 'vitest/config'

/**
 * Unit-test config for the Node-runnable app modules (endpoint selection,
 * storage migration). Separate from `vite.config.ts`, whose `root: 'src'`
 * would hide the `tests/` directory from vitest's default include.
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
  },
})
