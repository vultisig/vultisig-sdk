/**
 * sdk#1819: the SDK owns a `chain[:token]` text contract but had no canonical parser
 * for it, so consumers hand-split it. `clients/mcp`'s `parseChainToken` did
 * `input.split(':')` and read `parts[1]`, which is wrong in two silent ways — both
 * pinned below as the regressions this parser exists to prevent.
 */
import { describe, expect, it } from 'vitest'

import { parseAssetRef, splitAssetRef } from '@/tools/parse'

describe('splitAssetRef — grammar only, no chain resolution (sdk#1819)', () => {
  it('accepts a bare chain ref', () => {
    expect(splitAssetRef('eth')).toEqual({ success: true, chainRef: 'eth' })
  })

  it('accepts chain:token', () => {
    expect(splitAssetRef('eth:usdc')).toEqual({ success: true, chainRef: 'eth', ticker: 'usdc' })
  })

  it('trims surrounding whitespace', () => {
    expect(splitAssetRef('  eth:usdc  ')).toEqual({ success: true, chainRef: 'eth', ticker: 'usdc' })
  })

  // --- the two silent failures of the old `input.split(':')` shape ---

  it('REJECTS a multi-separator ref instead of discarding the tail', () => {
    // Old behaviour: { chain: 'eth', symbol: 'usdc' } — 'extra' silently dropped, so a
    // malformed ref was accepted as a valid one naming a DIFFERENT asset.
    const r = splitAssetRef('eth:usdc:extra')
    expect(r.success).toBe(false)
    expect(r.success === false && r.error).toMatch(/expected 'chain' or 'chain:token'/)
  })

  it('REJECTS a trailing separator instead of yielding an empty ticker', () => {
    // Old behaviour: { chain: 'eth', symbol: '' } — an empty symbol carried downstream
    // as though the caller had named a token.
    const r = splitAssetRef('eth:')
    expect(r.success).toBe(false)
    expect(r.success === false && r.error).toMatch(/Malformed asset ref/)
  })

  it('rejects an empty chain half', () => {
    const r = splitAssetRef(':usdc')
    expect(r.success).toBe(false)
    expect(r.success === false && r.error).toMatch(/chain half is empty/)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['whitespace only', '   '],
  ])('rejects %s', (_label, input) => {
    expect(splitAssetRef(input as string | null | undefined).success).toBe(false)
  })

  it('rejects a ticker that fails format validation', () => {
    const r = splitAssetRef('eth:not a ticker')
    expect(r.success).toBe(false)
  })

  it('does NOT resolve the chain — an unknown chain still splits', () => {
    // This is the whole point of the split/parse separation: a vault-scoped consumer
    // resolves the chain itself, so grammar validation must not pre-judge it.
    expect(splitAssetRef('not-a-real-chain:usdc')).toEqual({
      success: true,
      chainRef: 'not-a-real-chain',
      ticker: 'usdc',
    })
  })
})

describe('parseAssetRef — grammar + canonical chain resolution (sdk#1819)', () => {
  it('resolves a bare chain to its canonical Chain value', () => {
    expect(parseAssetRef('eth')).toEqual({ success: true, chain: 'Ethereum' })
  })

  it('resolves chain:token and preserves the ticker', () => {
    expect(parseAssetRef('eth:usdc')).toEqual({ success: true, chain: 'Ethereum', ticker: 'usdc' })
  })

  it('keeps accepting every alias form parseChain accepts', () => {
    // Guards against the new parser tightening the chain surface as a side effect.
    expect(parseAssetRef('Terra Classic')).toEqual({ success: true, chain: 'TerraClassic' })
    expect(parseAssetRef('btc')).toEqual({ success: true, chain: 'Bitcoin' })
  })

  it('fails closed on an unknown chain', () => {
    const r = parseAssetRef('not-a-real-chain:usdc')
    expect(r.success).toBe(false)
  })

  it('inherits the grammar rejections', () => {
    expect(parseAssetRef('eth:usdc:extra').success).toBe(false)
    expect(parseAssetRef('eth:').success).toBe(false)
  })

  it('never throws, for any input shape', () => {
    for (const input of [null, undefined, '', '::::', 'eth:', ':', '   ']) {
      expect(() => parseAssetRef(input as string | null | undefined)).not.toThrow()
    }
  })
})
