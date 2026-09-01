import { describe, expect, it } from 'vitest'
import {
  endpointsOf, isLoopbackHostname, isTailscaleEndpoint, normalizeEndpoint, selectCandidates,
} from '../src/EndpointSelection.ts'

describe('normalizeEndpoint', () => {
  it('adds a missing scheme and returns the canonical origin', () => {
    expect(normalizeEndpoint('192.168.1.5:3080')).toBe('http://192.168.1.5:3080')
  })

  it('keeps an explicit http scheme and strips paths', () => {
    expect(normalizeEndpoint('http://mypc.tailnet.ts.net:3080/gui')).toBe('http://mypc.tailnet.ts.net:3080')
  })

  it('keeps an https scheme', () => {
    expect(normalizeEndpoint('https://mypc.tailnet.ts.net:3080')).toBe('https://mypc.tailnet.ts.net:3080')
  })

  it('normalizes a default port to the scheme canonical form', () => {
    expect(normalizeEndpoint('http://192.168.1.5:80')).toBe('http://192.168.1.5')
  })

  it('rejects non-HTTP schemes', () => {
    expect(normalizeEndpoint('ftp://192.168.1.5')).toBeNull()
    expect(normalizeEndpoint('javascript:alert(1)')).toBeNull()
  })

  it('rejects malformed input', () => {
    expect(normalizeEndpoint('http://')).toBeNull()
  })
})

describe('isTailscaleEndpoint', () => {
  it('recognizes Tailscale IPv4, IPv6, and tailnet DNS addresses', () => {
    expect(isTailscaleEndpoint('http://100.64.0.1:3080')).toBe(true)
    expect(isTailscaleEndpoint('http://100.127.255.254:3080')).toBe(true)
    expect(isTailscaleEndpoint('http://[fd7a:115c:a1e0::1]:3080')).toBe(true)
    expect(isTailscaleEndpoint('https://workstation.example-tailnet.ts.net:3080')).toBe(true)
  })

  it('does not classify LAN, public, or out-of-range CGNAT addresses as Tailscale', () => {
    expect(isTailscaleEndpoint('http://192.168.1.5:3080')).toBe(false)
    expect(isTailscaleEndpoint('http://100.63.255.255:3080')).toBe(false)
    expect(isTailscaleEndpoint('http://100.128.0.1:3080')).toBe(false)
    expect(isTailscaleEndpoint('https://example.com')).toBe(false)
  })
})

describe('isLoopbackHostname', () => {
  it('matches the loopback aliases', () => {
    expect(isLoopbackHostname('127.0.0.1')).toBe(true)
    expect(isLoopbackHostname('::1')).toBe(true)
    expect(isLoopbackHostname('localhost')).toBe(true)
  })

  it('rejects non-loopback hostnames', () => {
    expect(isLoopbackHostname('192.168.1.5')).toBe(false)
    expect(isLoopbackHostname('mypc.tailnet.ts.net')).toBe(false)
    expect(isLoopbackHostname('100.64.0.1')).toBe(false)
  })
})

describe('endpointsOf', () => {
  it('keeps LAN and Tailscale origins in order', () => {
    expect(endpointsOf([
      'http://192.168.1.5:3080',
      'http://mypc.tailnet.ts.net:3080',
    ])).toEqual([
      'http://192.168.1.5:3080',
      'http://mypc.tailnet.ts.net:3080',
    ])
  })

  it('drops loopback aliases (from the phone they mean the phone itself)', () => {
    expect(endpointsOf([
      'http://127.0.0.1:3080',
      'http://localhost:3080',
      'http://[::1]:3080',
      'http://192.168.1.5:3080',
    ])).toEqual(['http://192.168.1.5:3080'])
  })

  it('dedupes origins that differ only in spelling', () => {
    expect(endpointsOf([
      '192.168.1.5:3080',
      'http://192.168.1.5:3080/',
      'http://192.168.1.5:3080',
    ])).toEqual(['http://192.168.1.5:3080'])
  })

  it('drops invalid entries instead of failing', () => {
    expect(endpointsOf(['http://192.168.1.5:3080', 'http://'])).toEqual(['http://192.168.1.5:3080'])
  })

  it('returns an empty list for an empty or all-loopback payload', () => {
    expect(endpointsOf([])).toEqual([])
    expect(endpointsOf(['http://127.0.0.1:3080'])).toEqual([])
  })
})

describe('selectCandidates', () => {
  it('tries the last-successful origin first, then the stored order', () => {
    expect(selectCandidates(
      ['http://192.168.1.5:3080', 'http://mypc.tailnet.ts.net:3080'],
      'http://mypc.tailnet.ts.net:3080',
    )).toEqual([
      'http://mypc.tailnet.ts.net:3080',
      'http://192.168.1.5:3080',
    ])
  })

  it('returns the stored order without a last-successful origin', () => {
    expect(selectCandidates(['http://192.168.1.5:3080', 'http://100.64.0.1:3080'], undefined))
      .toEqual(['http://192.168.1.5:3080', 'http://100.64.0.1:3080'])
  })

  it('dedupes', () => {
    expect(selectCandidates(['http://a:1', 'http://a:1', 'http://b:2'], 'http://a:1'))
      .toEqual(['http://a:1', 'http://b:2'])
  })

  it('keeps a last-successful origin that is not in the stored list', () => {
    expect(selectCandidates(['http://a:1'], 'http://b:2')).toEqual(['http://b:2', 'http://a:1'])
  })

  it('handles an empty list', () => {
    expect(selectCandidates([], 'http://a:1')).toEqual(['http://a:1'])
    expect(selectCandidates([], undefined)).toEqual([])
  })
})
