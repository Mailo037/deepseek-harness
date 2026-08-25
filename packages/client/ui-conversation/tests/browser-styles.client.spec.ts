/**
 * MessageItem compaction spacing contract, asserted against the CSS text on
 * disk: the expanded compaction summary scrolls inside its own bounded frame
 * instead of stretching the transcript, in the same rhythm as the Think row.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/chat/MessageItem.module.css', import.meta.url)), 'utf8')

/**
 * Declarations of one selector rule, keyed by property with whitespace collapsed.
 * @param selector - one exact selector, including a leading dot for local classes.
 * @returns the rule's declarations, or undefined when no such rule exists.
 */
function declarationsFrom(source: string, selector: string): Map<string, string> | undefined {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, ' ')
  const found = new Map<string, string>()
  for (const [, selectorList = '', body = ''] of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectorList.split(',').map(value => value.trim()).includes(selector)) continue
    for (const part of body.split(';')) {
      const colon = part.indexOf(':')
      if (colon === -1) continue
      found.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim().replace(/\s+/g, ' '))
    }
  }
  return found.size === 0 ? undefined : found
}

const declarations = (selector: string): Map<string, string> | undefined => declarationsFrom(css, selector)

describe('MessageItem.module.css compaction marker', () => {
  it('bounds the expanded summary in its own scrollport', () => {
    const body = declarations('.compactionBody')
    expect(body).toBeDefined()
    expect(body!.get('max-height')).toBe('240px')
    expect(body!.get('overflow-y')).toBe('auto')
    expect(body!.get('overscroll-behavior')).toBe('contain')
  })
})
