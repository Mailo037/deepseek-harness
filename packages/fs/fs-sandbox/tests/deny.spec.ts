import { describe, expect, it } from 'vitest'
import { isDenied } from '../src/deny.ts'

describe('isDenied', () => {
  it('empty list allows everything', () => {
    expect(isDenied('/a/.env', [])).toBe(false)
  })

  it('specific dotfile pattern matches at any depth', () => {
    expect(isDenied('/home/user/.env', ['**/.env'])).toBe(true)
  })

  it('dotfile pattern matches nested projects', () => {
    expect(isDenied('/home/user/project/.env', ['**/.env'])).toBe(true)
  })

  it('dotfile pattern matches a bare filename', () => {
    expect(isDenied('.env', ['**/.env'])).toBe(true)
  })

  it('dot-star matches a dotfile at depth', () => {
    expect(isDenied('/home/user/.env', ['.*'])).toBe(true)
  })

  it('dot-star matches a dotfile path segment', () => {
    expect(isDenied('/home/user/.ssh/config', ['.*'])).toBe(true)
  })

  it('dot-star does not match a regular file', () => {
    expect(isDenied('/home/user/app.js', ['.*'])).toBe(false)
  })

  it('bare name matches a directory at depth', () => {
    expect(isDenied('/project/node_modules', ['node_modules'])).toBe(true)
  })

  it('bare name matches a file under a matching directory', () => {
    expect(isDenied('/project/node_modules/foo.js', ['node_modules'])).toBe(true)
  })

  it('recursive pattern matches deeply nested files', () => {
    expect(isDenied('/project/node_modules/foo/bar.js', ['node_modules/**'])).toBe(true)
  })

  it('recursive pattern matches the directory itself', () => {
    expect(isDenied('/project/node_modules', ['node_modules/**'])).toBe(true)
  })

  it('root-anchored pattern does not match a sibling name', () => {
    expect(isDenied('/root.env', ['/.env'])).toBe(false)
  })

  it('root-anchored pattern matches at root', () => {
    expect(isDenied('/.env', ['/.env'])).toBe(true)
  })

  it('double-star alone matches everything', () => {
    expect(isDenied('/anything', ['**'])).toBe(true)
  })

  it('matches Windows backslash paths', () => {
    expect(isDenied('C:\\Users\\me\\project\\.env', ['**/.env'])).toBe(true)
    expect(isDenied('C:\\Users\\me\\.ssh\\config', ['**/.ssh/**'])).toBe(true)
    expect(isDenied('C:\\Users\\me\\project\\node_modules\\pkg\\index.js', ['node_modules/**'])).toBe(true)
  })

  it('denies symlink alias via canonical target key', () => {
    expect(isDenied('/home/user/symlink_to_env', ['**/.env'])).toBe(false)
    expect(isDenied('/home/user/canonical/.env', ['**/.env'])).toBe(true)
  })
})
