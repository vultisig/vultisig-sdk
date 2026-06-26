import { describe, expect, it } from 'vitest'

import { getUrlBaseDomain } from './baseDomain'

describe('getUrlBaseDomain', () => {
  it('returns the registrable domain for normal hosts', () => {
    expect(getUrlBaseDomain('https://app.uniswap.org')).toBe('uniswap.org')
    expect(getUrlBaseDomain('https://uniswap.org')).toBe('uniswap.org')
    expect(getUrlBaseDomain('https://a.b.c.example.com/path?q=1')).toBe('example.com')
  })

  it('treats multi-label public suffixes as distinct registrable domains', () => {
    // Regression: previously both collapsed to `vercel.app`, letting an
    // attacker site inherit a sibling's authorized dApp session.
    expect(getUrlBaseDomain('https://good-app.vercel.app')).toBe('good-app.vercel.app')
    expect(getUrlBaseDomain('https://attacker.vercel.app')).toBe('attacker.vercel.app')
    expect(getUrlBaseDomain('https://good-app.vercel.app')).not.toBe(getUrlBaseDomain('https://attacker.vercel.app'))
  })

  it('handles other common multi-label public suffixes', () => {
    expect(getUrlBaseDomain('https://me.github.io')).toBe('me.github.io')
    expect(getUrlBaseDomain('https://site.pages.dev')).toBe('site.pages.dev')
    expect(getUrlBaseDomain('https://app.web.app')).toBe('app.web.app')
  })

  it('handles ccSLD public suffixes', () => {
    expect(getUrlBaseDomain('https://shop.example.co.uk')).toBe('example.co.uk')
  })

  it('falls back to the hostname when there is no registrable domain', () => {
    expect(getUrlBaseDomain('http://localhost:8080')).toBe('localhost')
    expect(getUrlBaseDomain('http://127.0.0.1:3000')).toBe('127.0.0.1')
  })
})
