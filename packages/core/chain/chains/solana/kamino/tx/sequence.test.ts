import { describe, expect, it } from 'vitest'

import { kaminoAttributionMemoTagBytes, kaminoDiscriminators } from './instructions'
import { expectedKaminoSequence, KaminoInstructionKind, kaminoInstructionKind, matchKaminoSequence } from './sequence'

const encode = (text: string) => new TextEncoder().encode(text)

describe('kaminoInstructionKind', () => {
  it('maps both withdraw discriminators onto one kind', () => {
    // Which of the two the builder emits says only whether the vault's liquid
    // buffer covered the request — a fact about the vault's balance sheet,
    // not about what the user is being asked to approve.
    const shareArgument = new Uint8Array(8)
    expect(
      kaminoInstructionKind('kvault', Uint8Array.from([...kaminoDiscriminators.kvaultWithdraw, ...shareArgument]))
    ).toBe('kvaultWithdraw')
    expect(
      kaminoInstructionKind(
        'kvault',
        Uint8Array.from([...kaminoDiscriminators.kvaultWithdrawFromAvailable, ...shareArgument])
      )
    ).toBe('kvaultWithdraw')
  })

  it('recognises the attribution memo whole, and refuses every near-miss', () => {
    expect(kaminoInstructionKind('memo', kaminoAttributionMemoTagBytes)).toBe('attributionMemo')
    for (const nearMiss of ['8K2MZ', '8k2mz ', ' 8k2mz', '8k2m', '8k2mzz', 'vs', '']) {
      expect(kaminoInstructionKind('memo', encode(nearMiss)), JSON.stringify(nearMiss)).toBeUndefined()
    }
  })

  it('returns undefined for a foreign program or unknown discriminator', () => {
    expect(kaminoInstructionKind(undefined, kaminoDiscriminators.kvaultDeposit)).toBeUndefined()
    expect(kaminoInstructionKind('kvault', Uint8Array.from(new Array(16).fill(9)))).toBeUndefined()
    expect(kaminoInstructionKind('farms', kaminoDiscriminators.kvaultDeposit)).toBeUndefined()
  })
})

describe('expectedKaminoSequence + matchKaminoSequence', () => {
  const match = (kinds: (KaminoInstructionKind | undefined)[], steps: ReturnType<typeof expectedKaminoSequence>) =>
    matchKaminoSequence(kinds, steps)

  const injectedDeposit = expectedKaminoSequence({
    operation: 'deposit',
    isWrappedSolVault: false,
    hasFarm: true,
    hasPriorityFee: true,
    hasAttributionMemo: true,
    farmUnstake: 'forbidden',
  })

  it('accepts the injected farmed deposit shape', () => {
    const outcome = match(
      [
        'computeUnitLimit',
        'computeUnitPrice',
        'createTokenAccount',
        'kvaultDeposit',
        'farmsInitializeUser',
        'farmsStake',
        'attributionMemo',
      ],
      injectedDeposit
    )
    expect('matched' in outcome).toBe(true)
  })

  it('refuses an instruction the template does not name', () => {
    const outcome = match(
      ['computeUnitLimit', 'computeUnitPrice', 'kvaultDeposit', 'farmsStake', 'attributionMemo', undefined],
      injectedDeposit
    )
    expect(outcome).toEqual({ mismatch: { unexpectedInstruction: { index: 5 } } })
  })

  it('refuses a deposit missing its required farm stake', () => {
    const outcome = match(['computeUnitLimit', 'computeUnitPrice', 'kvaultDeposit', 'attributionMemo'], injectedDeposit)
    expect(outcome).toEqual({ mismatch: { missingInstruction: 'farm stake' } })
  })

  it('refuses a memo missing after injection claims to have added one', () => {
    const outcome = match(['computeUnitLimit', 'computeUnitPrice', 'kvaultDeposit', 'farmsStake'], injectedDeposit)
    expect(outcome).toEqual({ mismatch: { missingInstruction: 'attribution memo' } })
  })

  it('a withdraw that must not touch the farm refuses one that does', () => {
    const steps = expectedKaminoSequence({
      operation: 'withdraw',
      isWrappedSolVault: false,
      hasFarm: true,
      hasPriorityFee: false,
      hasAttributionMemo: false,
      farmUnstake: 'forbidden',
    })
    const outcome = match(['farmsUnstake', 'farmsWithdrawUnstakedDeposits', 'kvaultWithdraw'], steps)
    expect('mismatch' in outcome).toBe(true)
  })

  it('a farm release without its companion is refused even when optional', () => {
    // An unstake on its own is not a smaller version of the pair — it takes
    // shares out of the farm and strands them somewhere neither the position
    // read nor the verify screen describes.
    const steps = expectedKaminoSequence({
      operation: 'withdraw',
      isWrappedSolVault: false,
      hasFarm: true,
      hasPriorityFee: false,
      hasAttributionMemo: false,
      farmUnstake: 'unknown',
    })
    const outcome = match(['farmsUnstake', 'kvaultWithdraw'], steps)
    expect('mismatch' in outcome).toBe(true)
    const complete = match(['farmsUnstake', 'farmsWithdrawUnstakedDeposits', 'kvaultWithdraw'], steps)
    expect('matched' in complete).toBe(true)
  })

  it('the wrapped-SOL withdraw requires at least one close, repeatably', () => {
    // "One or more" must not silently become "zero or more": closing the
    // payout account is what unwraps wSOL into the SOL the screen promises.
    const steps = expectedKaminoSequence({
      operation: 'withdraw',
      isWrappedSolVault: true,
      hasFarm: true,
      hasPriorityFee: false,
      hasAttributionMemo: false,
      farmUnstake: 'forbidden',
    })
    expect(match(['kvaultWithdraw'], steps)).toEqual({ mismatch: { missingInstruction: 'close token account' } })
    expect('matched' in match(['kvaultWithdraw', 'closeTokenAccount', 'closeTokenAccount'], steps)).toBe(true)
  })

  it('a second attribution memo has no place in the template', () => {
    const outcome = match(
      ['computeUnitLimit', 'computeUnitPrice', 'kvaultDeposit', 'farmsStake', 'attributionMemo', 'attributionMemo'],
      injectedDeposit
    )
    expect(outcome).toEqual({ mismatch: { unexpectedInstruction: { index: 5 } } })
  })

  it('refuses a compute budget pair the intent did not inject', () => {
    const steps = expectedKaminoSequence({
      operation: 'deposit',
      isWrappedSolVault: false,
      hasFarm: false,
      hasPriorityFee: false,
      hasAttributionMemo: false,
      farmUnstake: 'forbidden',
    })
    // The walk reports the required step the budget pair displaced: nothing
    // in a fee-less template can consume the pair, so the deposit that should
    // sit at the front goes unmatched.
    const outcome = match(['computeUnitLimit', 'computeUnitPrice', 'kvaultDeposit'], steps)
    expect(outcome).toEqual({ mismatch: { missingInstruction: 'vault deposit' } })
  })
})
