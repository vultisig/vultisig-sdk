import { describe, expect, it } from 'vitest'

import {
  chainAliasMap,
  chainsMatch,
  checkInvariants,
  claimInterpretations,
  type Envelope,
  evaluatePolicy,
  type IntentClaim,
  Invariant,
  isZeroAmount,
  parseAmountBig,
  policy,
  ResultKind,
  scaleDecimalClaimToAtomic,
} from '@/tools/policy'

const usdc = (recipient: string, amount: bigint): Envelope => ({
  decoded: true,
  chainId: 'base',
  recipient,
  asset: { symbol: 'USDC', decimals: 6 },
  amount,
})

describe('evaluatePolicy', () => {
  it('BLOCKs on recipient mismatch (send 1 USDC to 0xAAA vs envelope 0xBBB)', () => {
    const claim: IntentClaim = {
      chain: 'base',
      recipient: '0xAAA',
      asset: 'USDC',
      amount: '1',
      amountUnits: 'human',
    }
    const verdict = evaluatePolicy(claim, usdc('0xBBB', 1_000_000n))
    expect(verdict.result).toBe(ResultKind.Block)
    expect(verdict.diff).toEqual([{ field: 'recipient', claimed: '0xaaa', observed: '0xbbb' }])
  })

  it('PASSes a matching pair (recipient + amount + asset + chain all agree)', () => {
    const claim: IntentClaim = {
      chain: 'base',
      recipient: '0xAAA',
      asset: 'USDC',
      amount: '1',
      amountUnits: 'human',
    }
    const verdict = evaluatePolicy(claim, usdc('0xAAA', 1_000_000n))
    expect(verdict.result).toBe(ResultKind.Pass)
    expect(verdict.diff).toHaveLength(0)
  })

  it('recipient comparison is case-insensitive (EVM checksum drift is not a mismatch)', () => {
    const claim: IntentClaim = { chain: 'base', recipient: '0xAbCdEf', amount: '1', amountUnits: 'human' }
    const verdict = evaluatePolicy(claim, usdc('0xABCDEF', 1_000_000n))
    expect(verdict.result).toBe(ResultKind.Pass)
  })

  it('BLOCKs on chain mismatch before checking other fields', () => {
    const claim: IntentClaim = { chain: 'ethereum', recipient: '0xAAA' }
    const verdict = evaluatePolicy(claim, usdc('0xAAA', 1_000_000n))
    expect(verdict.result).toBe(ResultKind.Block)
    expect(verdict.reason).toContain('chain mismatch')
  })

  it('honors the chain alias map (eth ⇔ ethereum)', () => {
    const claim: IntentClaim = { chain: 'eth', recipient: '0xAAA' }
    const verdict = evaluatePolicy(claim, { ...usdc('0xAAA', 1_000_000n), chainId: 'ethereum' })
    expect(verdict.result).toBe(ResultKind.Pass)
  })

  it('BLOCKs on amount drift > 1% (claim 1 USDC vs envelope 2 USDC)', () => {
    const claim: IntentClaim = { chain: 'base', recipient: '0xAAA', amount: '1', amountUnits: 'human' }
    const verdict = evaluatePolicy(claim, usdc('0xAAA', 2_000_000n))
    expect(verdict.result).toBe(ResultKind.Block)
    expect(verdict.reason).toContain('amount drift')
  })

  it('WARNs on amount drift between 0.1% and 1%', () => {
    // claim 1000 USDC (1_000_000_000 base) vs 1_005_000_000 → 0.5% drift
    const claim: IntentClaim = { chain: 'base', recipient: '0xAAA', amount: '1000', amountUnits: 'human' }
    const verdict = evaluatePolicy(claim, usdc('0xAAA', 1_005_000_000n))
    expect(verdict.result).toBe(ResultKind.Warn)
    expect(verdict.diff[0]?.field).toBe('amount')
  })

  it('WARNs on asset symbol display-name drift', () => {
    const claim: IntentClaim = { chain: 'base', recipient: '0xAAA', asset: 'USDbC', amount: '1', amountUnits: 'human' }
    const verdict = evaluatePolicy(claim, usdc('0xAAA', 1_000_000n))
    expect(verdict.result).toBe(ResultKind.Warn)
    expect(verdict.diff).toEqual([{ field: 'asset', claimed: 'USDBC', observed: 'USDC' }])
  })

  it('fails open to WARN on an undecoded envelope', () => {
    const verdict = evaluatePolicy({ recipient: '0xAAA' }, { decoded: false, decodeError: 'unsupported chain' })
    expect(verdict.result).toBe(ResultKind.Warn)
    expect(verdict.reason).toContain('not decoded')
  })

  it('1-wei sink is closed: claim "1" ETH (human, 18 dp) vs a 1-wei envelope BLOCKs', () => {
    const claim: IntentClaim = { chain: 'ethereum', recipient: '0xAAA', amount: '1', amountUnits: 'human' }
    const env: Envelope = {
      decoded: true,
      chainId: 'ethereum',
      recipient: '0xAAA',
      asset: { symbol: 'ETH', decimals: 18 },
      amount: 1n,
    }
    expect(evaluatePolicy(claim, env).result).toBe(ResultKind.Block)
  })

  it('policy namespace exposes evaluate + checkInvariants', () => {
    expect(policy.evaluate).toBe(evaluatePolicy)
    expect(policy.checkInvariants).toBe(checkInvariants)
  })
})

describe('checkInvariants', () => {
  it('reports every violation independently (I1 recipient + I3 chain)', () => {
    const violations = checkInvariants({
      claim: { chain: 'ethereum', recipient: '0xAAA', amount: '1', amountUnits: 'human' },
      envelope: {
        decoded: true,
        chainId: 'base',
        recipient: '0xBBB',
        asset: { symbol: 'USDC', decimals: 6 },
        amount: 1_000_000n,
      },
    })
    const kinds = violations.map(v => v.invariant)
    expect(kinds).toContain(Invariant.RecipientMatchesIntent)
    expect(kinds).toContain(Invariant.ChainMatchesIntent)
  })

  it('I3 fires when the envelope DROPPED a stated chain (empty decoded field)', () => {
    const violations = checkInvariants({
      claim: { chain: 'base', recipient: '0xAAA' },
      envelope: { decoded: true, chainId: '', recipient: '0xAAA' },
    })
    expect(violations.map(v => v.invariant)).toContain(Invariant.ChainMatchesIntent)
  })

  it('I4 fires when signing without confirmation', () => {
    const violations = checkInvariants({
      claim: { recipient: '0xAAA' },
      envelope: { decoded: true, recipient: '0xAAA' },
      signing: true,
      confirmed: false,
    })
    expect(violations.map(v => v.invariant)).toEqual([Invariant.NoSignWithoutConfirm])
  })

  it('I5 fires when amount exceeds balance', () => {
    const violations = checkInvariants({
      claim: { recipient: '0xAAA', amount: '5', amountUnits: 'human' },
      envelope: { decoded: true, recipient: '0xAAA', asset: { symbol: 'USDC', decimals: 6 }, amount: 5_000_000n },
      balance: 1_000_000n,
    })
    expect(violations.map(v => v.invariant)).toContain(Invariant.NeverExceedBalance)
  })

  it('I2 fires on amount drift > 1% under all interpretations (claim 1 USDC vs envelope 2 USDC)', () => {
    const violations = checkInvariants({
      claim: { chain: 'base', recipient: '0xAAA', amount: '1', amountUnits: 'human' },
      envelope: {
        decoded: true,
        chainId: 'base',
        recipient: '0xAAA',
        asset: { symbol: 'USDC', decimals: 6 },
        amount: 2_000_000n,
      },
    })
    expect(violations.map(v => v.invariant)).toEqual([Invariant.AmountMatchesIntent])
  })

  it('I2 fires when the claim is non-zero but the envelope sends zero', () => {
    const violations = checkInvariants({
      claim: { chain: 'base', recipient: '0xAAA', amount: '1', amountUnits: 'human' },
      envelope: {
        decoded: true,
        chainId: 'base',
        recipient: '0xAAA',
        asset: { symbol: 'USDC', decimals: 6 },
        amount: 0n,
      },
    })
    expect(violations.map(v => v.invariant)).toEqual([Invariant.AmountMatchesIntent])
  })

  it('I6 fires when a tool output rewrites a stated recipient', () => {
    const violations = checkInvariants({
      claim: { recipient: '0xAAA' },
      envelope: { decoded: true, recipient: '0xAAA' },
      postToolClaim: { recipient: '0xBBB' },
    })
    expect(violations.map(v => v.invariant)).toEqual([Invariant.OutputCannotMutateIntent])
  })

  it('I7 fires when a stated memo is dropped from the envelope', () => {
    const violations = checkInvariants({
      claim: { recipient: '0xAAA' },
      envelope: { decoded: true, recipient: '0xAAA' },
      userMemo: '12345',
      envelopeMemo: '',
    })
    expect(violations.map(v => v.invariant)).toContain(Invariant.MemoPreserved)
  })

  it('returns no violations for a fully-matching confirmed send', () => {
    const violations = checkInvariants({
      claim: { chain: 'base', recipient: '0xAAA', amount: '1', amountUnits: 'human' },
      envelope: {
        decoded: true,
        chainId: 'base',
        recipient: '0xAAA',
        asset: { symbol: 'USDC', decimals: 6 },
        amount: 1_000_000n,
      },
      signing: true,
      confirmed: true,
      balance: 10_000_000n,
      userMemo: '',
    })
    expect(violations).toHaveLength(0)
  })
})

describe('amount helpers', () => {
  it('scaleDecimalClaimToAtomic does exact bigint scaling', () => {
    expect(scaleDecimalClaimToAtomic('0.25', 18)).toBe(250000000000000000n)
    expect(scaleDecimalClaimToAtomic('1', 6)).toBe(1_000_000n)
    expect(scaleDecimalClaimToAtomic('.5', 2)).toBe(50n)
    // more fraction digits than the token supports → null (skip, don't guess)
    expect(scaleDecimalClaimToAtomic('0.123', 2)).toBeNull()
    // unknown decimals
    expect(scaleDecimalClaimToAtomic('1', 0)).toBeNull()
    // drain words / non-numeric
    expect(scaleDecimalClaimToAtomic('max', 18)).toBeNull()
  })

  it('parseAmountBig parses integers and rejects floats/words', () => {
    expect(parseAmountBig('1500000')).toBe(1500000n)
    expect(parseAmountBig('1,000')).toBe(1000n)
    expect(parseAmountBig('1.5')).toBeNull()
    expect(parseAmountBig('all')).toBeNull()
  })

  it('isZeroAmount recognizes zero-like shapes but not 0.25/drain', () => {
    expect(isZeroAmount('0')).toBe(true)
    expect(isZeroAmount('0.0')).toBe(true)
    expect(isZeroAmount('0,000')).toBe(true)
    expect(isZeroAmount('0.25')).toBe(false)
    expect(isZeroAmount('max')).toBe(false)
  })

  it('claimInterpretations honors units provenance', () => {
    // human + known decimals → ONLY the scaled reading
    expect(claimInterpretations('1', 'human', 18)).toEqual([1000000000000000000n])
    // base → ONLY the raw integer
    expect(claimInterpretations('1000000', 'base', 6)).toEqual([1000000n])
    // unknown provenance → atomic + plausible ladder
    const ladder = claimInterpretations('1', '', 0)
    expect(ladder).toContain(1n) // atomic
    expect(ladder).toContain(1000000000000000000n) // 18-dp rung
  })
})

// The decoder (#848) is contracted to emit a SYMBOLIC chain ("base"), NOT the
// on-wire numeric EIP-155 id ("8453"). These tests pin that contract from the
// policy side: a symbolic↔symbolic compare PASSes, and a numeric id that slipped
// through un-resolved is correctly NOT matched (fail-safe BLOCK, never a silent
// pass) — so any decoder regression that leaks a numeric chain id is caught here
// instead of producing a spurious cross-surface verdict.
describe('chainsMatch — symbolic-chain contract with the decoder', () => {
  it('matches a symbolic claim against a symbolic envelope (base ⇔ base)', () => {
    expect(chainsMatch('base', 'base')).toBe(true)
    const claim: IntentClaim = { chain: 'base', recipient: '0xAAA' }
    const verdict = evaluatePolicy(claim, usdc('0xAAA', 1_000_000n)) // envelope chainId 'base'
    expect(verdict.result).toBe(ResultKind.Pass)
  })

  it('does NOT match a symbolic claim against an un-resolved numeric chain id (8453)', () => {
    // chainAliasMap has no numeric keys, so "base" canonicalises to "base" and
    // "8453" stays "8453" → no match. This is the fail-safe: if #848 ever leaks a
    // raw numeric id, the policy BLOCKs rather than silently passing it.
    expect(chainsMatch('base', '8453')).toBe(false)
    expect(chainsMatch('ethereum', '1')).toBe(false)
    const claim: IntentClaim = { chain: 'base', recipient: '0xAAA' }
    const verdict = evaluatePolicy(claim, { ...usdc('0xAAA', 1_000_000n), chainId: '8453' })
    expect(verdict.result).toBe(ResultKind.Block)
    expect(verdict.reason).toContain('chain mismatch')
  })

  it('is symmetric and self-reflexive across the alias set', () => {
    expect(chainsMatch('eth', 'ethereum')).toBe(true)
    expect(chainsMatch('ethereum', 'eth')).toBe(true) // symmetry
    expect(chainsMatch('cosmos', 'cosmoshub-4')).toBe(true)
    expect(chainsMatch('lunc', 'columbus-5')).toBe(true)
    expect(chainsMatch('terraclassic', 'columbus-5')).toBe(true) // two aliases → same canon
    expect(chainsMatch('ethereum', 'base')).toBe(false)
    expect(chainsMatch('cosmoshub-4', 'osmosis-1')).toBe(false)
  })

  it('mirrors the Go chainAliasMap 1:1 (no cross-surface drift)', () => {
    // Pinned verbatim from internal/safety/policy.go @ b6956d75c. A diff here
    // means the SDK and Go verdicts can disagree on a chain alias — a P0-class
    // cross-surface divergence — so this must be updated in lockstep with Go.
    expect(chainAliasMap).toEqual({
      eth: 'ethereum',
      bnb: 'bsc',
      bsc: 'bsc',
      avax: 'avalanche',
      cosmos: 'cosmoshub-4',
      terra: 'phoenix-1',
      terraclassic: 'columbus-5',
      lunc: 'columbus-5',
      osmosis: 'osmosis-1',
      noble: 'noble-1',
      dydx: 'dydx-mainnet-1',
      akash: 'akashnet-2',
    })
  })
})
