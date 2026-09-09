import { describe, expect, it } from 'vitest'
import { createElectronLaunchItemBackend, loginItemSupported } from '../src/login-item.ts'
import type { ElectronAppFace } from '../src/login-item.ts'

function fakeApp(isPackaged: boolean): ElectronAppFace & { calls: Array<{ openAtLogin: boolean }> } {
  const calls: Array<{ openAtLogin: boolean }> = []
  return {
    isPackaged,
    setLoginItemSettings: (settings) => { calls.push(settings) },
    calls,
  }
}

describe('loginItemSupported', () => {
  it('supports Windows always and macOS only packaged', () => {
    expect(loginItemSupported('win32', false)).toBe(true)
    expect(loginItemSupported('win32', true)).toBe(true)
    expect(loginItemSupported('darwin', true)).toBe(true)
    expect(loginItemSupported('darwin', false)).toBe(false)
    expect(loginItemSupported('linux', true)).toBe(false)
  })
})

describe('createElectronLaunchItemBackend', () => {
  it('reports supported and forwards apply on Windows', () => {
    const appFace = fakeApp(false)
    const backend = createElectronLaunchItemBackend(appFace)
    expect(backend.supported).toBe(true)
    backend.apply(true)
    backend.apply(false)
    expect(appFace.calls).toEqual([{ openAtLogin: true }, { openAtLogin: false }])
  })

  it('is unsupported on Linux and never touches login items there', () => {
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    try {
      const appFace = fakeApp(true)
      const backend = createElectronLaunchItemBackend(appFace)
      expect(backend.supported).toBe(false)
      backend.apply(true)
      expect(appFace.calls).toEqual([])
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
    }
  })

  it('is unsupported for an unpackaged macOS run', () => {
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    try {
      const appFace = fakeApp(false)
      const backend = createElectronLaunchItemBackend(appFace)
      expect(backend.supported).toBe(false)
      backend.apply(true)
      expect(appFace.calls).toEqual([])
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
    }
  })
})

describe('host wiring', () => {
  it('keeps host.ts Electron-free and wires the backend from the Electron entry', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const hostSource = readFileSync(fileURLToPath(new URL('../src/host.ts', import.meta.url)), 'utf8')
    expect(hostSource).not.toContain("from './login-item.ts'")
    expect(hostSource).toContain("provide('launchSettings', options.launchItem)")
    const entrySource = readFileSync(fileURLToPath(new URL('../src/index.ts', import.meta.url)), 'utf8')
    expect(entrySource).toContain('launchItem: createElectronLaunchItemBackend()')
  })
})
