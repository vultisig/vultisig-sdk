// Chain-argument validation (vultisig-sdk sdkcli2-13 P2-6 / P2-10).
//
// Regression guards:
//  - `tokens <bogus-chain>` exited 0 with `{"success":true,"data":{"tokens":[]}}` — a
//    machine caller could not distinguish "chain has no tokens" from "no such chain".
//  - `swap-quote <bogus-chain> ...` exited 7/UNKNOWN_ERROR with a raw
//    "Cannot read properties of undefined (reading 'ticker')" TypeError.
// Both call sites cast an unresolved name straight to `Chain`
// (`findChainByName(x) || (x as Chain)`); resolving up front turns both into
// INVALID_CHAIN / exit 4.
import { Chain } from '@vultisig/sdk'
import { describe, expect, it } from 'vitest'

import { resolveChainOrThrow, suggestChainNames } from './chain-resolver'
import { ExitCode, InvalidChainError } from './errors'

describe('resolveChainOrThrow', () => {
  it('resolves a known chain name case-insensitively', () => {
    expect(resolveChainOrThrow('Ethereum')).toBe(Chain.Ethereum)
    expect(resolveChainOrThrow('ethereum')).toBe(Chain.Ethereum)
    expect(resolveChainOrThrow('ETHEREUM')).toBe(Chain.Ethereum)
  })

  it('throws INVALID_CHAIN / exit 4 for an unknown chain instead of casting it through', () => {
    try {
      resolveChainOrThrow('bogus-chain')
      throw new Error('expected resolveChainOrThrow to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidChainError)
      const chainErr = err as InvalidChainError
      expect(chainErr.code).toBe('INVALID_CHAIN')
      expect(chainErr.exitCode).toBe(ExitCode.INVALID_INPUT)
      expect(chainErr.retryable).toBe(false)
    }
  })

  it('carries the offending name in the error context and message', () => {
    try {
      resolveChainOrThrow('bogus-chain')
      throw new Error('expected resolveChainOrThrow to throw')
    } catch (err) {
      expect((err as InvalidChainError).context).toMatchObject({ chain: 'bogus-chain' })
      expect((err as InvalidChainError).message).toContain('bogus-chain')
    }
  })

  it('names which side of a two-chain command was wrong', () => {
    expect(() => resolveChainOrThrow('nope', 'source chain')).toThrow(/Unsupported source chain: "nope"/)
    expect(() => resolveChainOrThrow('nope', 'destination chain')).toThrow(/Unsupported destination chain: "nope"/)
  })

  it('does not accept the empty string as a chain', () => {
    expect(() => resolveChainOrThrow('')).toThrow(InvalidChainError)
  })

  // bead vultisig-7eymb: `Cronos` (the brand) forced users to know the SDK enum
  // name `CronosChain`. Did-you-mean suggestion surfaces the closest match(es)
  // in both the human hint AND the error context so JSON callers can consume.
  it('suggests CronosChain when user types the Cronos brand', () => {
    try {
      resolveChainOrThrow('Cronos')
      throw new Error('expected resolveChainOrThrow to throw')
    } catch (err) {
      const chainErr = err as InvalidChainError
      expect(chainErr.hint ?? '').toMatch(/Did you mean.*CronosChain/)
      // context.suggestions is a comma-joined string (context values must be strings)
      expect(chainErr.context?.suggestions ?? '').toContain(Chain.CronosChain)
    }
  })

  it('falls back to the generic hint when no suggestion is close enough', () => {
    try {
      resolveChainOrThrow('zzzzzzzz')
      throw new Error('expected resolveChainOrThrow to throw')
    } catch (err) {
      const chainErr = err as InvalidChainError
      // No did-you-mean, just the original generic hint.
      expect(chainErr.hint ?? '').toMatch(/vultisig chains/)
      expect(chainErr.hint ?? '').not.toMatch(/Did you mean/)
    }
  })
})

describe('suggestChainNames', () => {
  it('suggests CronosChain for Cronos (prefix match, high score)', () => {
    const s = suggestChainNames('Cronos')
    expect(s[0]).toBe(Chain.CronosChain)
  })

  it('is case-insensitive', () => {
    expect(suggestChainNames('cronos')[0]).toBe(Chain.CronosChain)
    expect(suggestChainNames('CRONOS')[0]).toBe(Chain.CronosChain)
  })

  it('returns [] for empty input', () => {
    expect(suggestChainNames('')).toEqual([])
    expect(suggestChainNames('   ')).toEqual([])
  })

  it('caps the number of suggestions', () => {
    // A short common substring like "chain" matches multiple entries — the limit
    // guards against dumping half the enum into the error hint.
    const s = suggestChainNames('chain', 2)
    expect(s.length).toBeLessThanOrEqual(2)
  })
})
