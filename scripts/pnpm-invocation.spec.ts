import { describe, expect, it } from 'vitest'
import { pnpmInvocation } from './pnpm-invocation.ts'

describe('pnpm invocation resolution', () => {
  it('invokes JavaScript entrypoints through the host Node executable', () => {
    expect(pnpmInvocation(['run', 'build'], '/usr/local/lib/node_modules/pnpm/bin/pnpm.cjs')).toEqual({
      command: process.execPath,
      args: ['/usr/local/lib/node_modules/pnpm/bin/pnpm.cjs', 'run', 'build'],
    })

    expect(pnpmInvocation(['exec', 'vitest'], 'C:\\pnpm\\pnpm.js')).toEqual({
      command: process.execPath,
      args: ['C:\\pnpm\\pnpm.js', 'exec', 'vitest'],
    })

    expect(pnpmInvocation(['--version'], '/opt/pnpm/bin/pnpm.mjs')).toEqual({
      command: process.execPath,
      args: ['/opt/pnpm/bin/pnpm.mjs', '--version'],
    })
  })

  it('invokes native executable binaries directly without Node wrapping', () => {
    expect(pnpmInvocation(['run', 'build:lib'], 'C:\\Users\\user\\scoop\\apps\\pnpm\\current\\pnpm.exe')).toEqual({
      command: 'C:\\Users\\user\\scoop\\apps\\pnpm\\current\\pnpm.exe',
      args: ['run', 'build:lib'],
    })

    expect(pnpmInvocation(['exec', 'vitest'], '/usr/local/bin/pnpm')).toEqual({
      command: '/usr/local/bin/pnpm',
      args: ['exec', 'vitest'],
    })
  })

  it('rejects missing or empty entrypoints', () => {
    const previous = process.env.npm_execpath
    try {
      Reflect.deleteProperty(process.env, 'npm_execpath')
      expect(() => pnpmInvocation(['run', 'test']))
        .toThrow('pnpm invocation: npm_execpath is unavailable')
    } finally {
      if (previous !== undefined) process.env.npm_execpath = previous
    }
    expect(() => pnpmInvocation(['run', 'test'], ''))
      .toThrow('pnpm invocation: npm_execpath is unavailable')
  })
})
