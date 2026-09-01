import { describe, expect, it } from 'vitest'
import { isCommandDenied } from '../src/deny.ts'

describe('isCommandDenied', () => {
  it('rejects direct dotfile access', () => expect(isCommandDenied('cat .env', ['**/.env'])).toBe(true))
  it('rejects dotfile directory access', () => expect(isCommandDenied('ls -la ~/.ssh', ['**/.ssh/**'])).toBe(true))
  it('allows unrelated commands', () => expect(isCommandDenied('ls -la', ['**/.env'])).toBe(false))
  it('allows empty list', () => expect(isCommandDenied('cat .env', [])).toBe(false))
  it('matches Windows paths', () => expect(isCommandDenied('type C:\\Users\\me\\.env', ['**/.env'])).toBe(true))
})
