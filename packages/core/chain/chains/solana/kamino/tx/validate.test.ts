import { Keypair } from '@solana/web3.js'
import { describe, expect, it } from 'vitest'

import { kaminoShareAmount, kaminoTokenAmount } from '../amount'
import { kaminoVaultRegistry } from '../registry'
import {
  anchorU64Data,
  buildTestTransaction,
  depositInstructions,
  stakedWithdrawInstructions,
  testOwner,
  testVaultInfo,
  withdrawInstruction,
} from './__tests__/txTestKit'
import { kaminoAllowedPrograms, kaminoDiscriminators, kaminoFarmsStakeScale } from './instructions'
import { KaminoTransactionIntent, KaminoValidationError, validateKaminoTransaction } from './validate'
import { injectKaminoAttributionMemo, injectKaminoComputeBudget } from './wire'

const [steakhouseUsdc] = kaminoVaultRegistry
const vault = testVaultInfo(steakhouseUsdc)

const depositIntent = (amount: bigint): KaminoTransactionIntent => ({
  operation: { deposit: kaminoTokenAmount(amount, steakhouseUsdc.tokenDecimals) },
  vault,
  owner: testOwner,
  carriesAttributionMemo: false,
})

const withdrawIntent = (shares: bigint, unstakedShares: bigint): KaminoTransactionIntent => ({
  operation: {
    withdraw: {
      shares: kaminoShareAmount(shares, steakhouseUsdc.sharesDecimals),
      unstakedShares: kaminoShareAmount(unstakedShares, steakhouseUsdc.sharesDecimals),
    },
  },
  vault,
  owner: testOwner,
  carriesAttributionMemo: false,
})

const finding = (run: () => void): string => {
  try {
    run()
  } catch (error) {
    if (error instanceof KaminoValidationError) return error.finding
    throw error
  }
  throw new Error('expected a refusal')
}

describe('validateKaminoTransaction: deposit', () => {
  it('accepts the built shape before injection', () => {
    const { transaction, lookupTables } = buildTestTransaction({
      owner: testOwner,
      descriptor: steakhouseUsdc,
      instructions: depositInstructions(1_000_000n),
    })
    expect(() =>
      validateKaminoTransaction({ transaction, intent: depositIntent(1_000_000n), lookupTables })
    ).not.toThrow()
  })

  it('accepts the fully injected shape when the intent says so', () => {
    const { transaction, lookupTables } = buildTestTransaction({
      owner: testOwner,
      descriptor: steakhouseUsdc,
      instructions: depositInstructions(1_000_000n),
    })
    const complete = injectKaminoAttributionMemo(
      injectKaminoComputeBudget({ transaction, unitLimit: 320_000, unitPriceMicroLamports: 20_000n })
    )
    const intent: KaminoTransactionIntent = {
      ...depositIntent(1_000_000n),
      priorityFee: { unitLimit: 320_000, unitPriceMicroLamports: 20_000n },
      carriesAttributionMemo: true,
    }
    expect(() => validateKaminoTransaction({ transaction: complete, intent, lookupTables })).not.toThrow()
  })

  it('refuses a deposit whose instruction amount differs from the request', () => {
    const { transaction, lookupTables } = buildTestTransaction({
      owner: testOwner,
      descriptor: steakhouseUsdc,
      instructions: depositInstructions(2_000_000n),
    })
    expect(
      finding(() => validateKaminoTransaction({ transaction, intent: depositIntent(1_000_000n), lookupTables }))
    ).toBe('amountMismatch')
  })

  it('refuses a memo that arrives before injection', () => {
    const { transaction, lookupTables } = buildTestTransaction({
      owner: testOwner,
      descriptor: steakhouseUsdc,
      instructions: depositInstructions(1_000_000n),
    })
    const tagged = injectKaminoAttributionMemo(transaction)
    expect(
      finding(() => validateKaminoTransaction({ transaction: tagged, intent: depositIntent(1_000_000n), lookupTables }))
    ).toBe('unexpectedMemo')
  })

  it('refuses a priority fee that arrives before injection', () => {
    const { transaction, lookupTables } = buildTestTransaction({
      owner: testOwner,
      descriptor: steakhouseUsdc,
      instructions: depositInstructions(1_000_000n),
    })
    const withFee = injectKaminoComputeBudget({ transaction, unitLimit: 1, unitPriceMicroLamports: 1n })
    expect(
      finding(() =>
        validateKaminoTransaction({ transaction: withFee, intent: depositIntent(1_000_000n), lookupTables })
      )
    ).toBe('unexpectedPriorityFee')
  })

  it('refuses an injected fee that differs from the one the app chose', () => {
    const { transaction, lookupTables } = buildTestTransaction({
      owner: testOwner,
      descriptor: steakhouseUsdc,
      instructions: depositInstructions(1_000_000n),
    })
    const withFee = injectKaminoComputeBudget({ transaction, unitLimit: 320_000, unitPriceMicroLamports: 999_999n })
    const intent: KaminoTransactionIntent = {
      ...depositIntent(1_000_000n),
      priorityFee: { unitLimit: 320_000, unitPriceMicroLamports: 20_000n },
    }
    expect(finding(() => validateKaminoTransaction({ transaction: withFee, intent, lookupTables }))).toBe(
      'amountMismatch'
    )
  })

  it('refuses a stake that is not the whole-balance sentinel', () => {
    const { transaction, lookupTables } = buildTestTransaction({
      owner: testOwner,
      descriptor: steakhouseUsdc,
      instructions: indexes => {
        const [deposit, stake] = depositInstructions(1_000_000n)(indexes)
        stake.data = anchorU64Data(kaminoDiscriminators.farmsStake, 5n)
        return [deposit, stake]
      },
    })
    expect(
      finding(() => validateKaminoTransaction({ transaction, intent: depositIntent(1_000_000n), lookupTables }))
    ).toBe('amountMismatch')
  })

  it('refuses a foreign lookup table', () => {
    const { transaction, lookupTables } = buildTestTransaction({
      owner: testOwner,
      descriptor: steakhouseUsdc,
      instructions: depositInstructions(1_000_000n),
    })
    const intent: KaminoTransactionIntent = {
      ...depositIntent(1_000_000n),
      vault: { ...vault, lookupTable: Keypair.generate().publicKey.toBase58() },
    }
    expect(finding(() => validateKaminoTransaction({ transaction, intent, lookupTables }))).toBe(
      'unexpectedLookupTable'
    )
  })
})

describe('validateKaminoTransaction: withdraw', () => {
  it('accepts the liquid-buffer shape under the withdraw_from_available discriminator', () => {
    const { transaction, lookupTables } = buildTestTransaction({
      owner: testOwner,
      descriptor: steakhouseUsdc,
      instructions: withdrawInstruction(500_000n, kaminoDiscriminators.kvaultWithdrawFromAvailable),
    })
    expect(() =>
      validateKaminoTransaction({ transaction, intent: withdrawIntent(500_000n, 500_000n), lookupTables })
    ).not.toThrow()
  })

  it('accepts the reserve shape under the withdraw discriminator', () => {
    const { transaction, lookupTables } = buildTestTransaction({
      owner: testOwner,
      descriptor: steakhouseUsdc,
      instructions: withdrawInstruction(500_000n, kaminoDiscriminators.kvaultWithdraw),
    })
    expect(() =>
      validateKaminoTransaction({ transaction, intent: withdrawIntent(500_000n, 500_000n), lookupTables })
    ).not.toThrow()
  })

  it('accepts the farm-staked shape with the exact shortfall released', () => {
    const shares = 1_500_000n
    const unstaked = 900_000n
    const { transaction, lookupTables } = buildTestTransaction({
      owner: testOwner,
      descriptor: steakhouseUsdc,
      withFarmUserState: true,
      instructions: stakedWithdrawInstructions({
        shares,
        unstakeScaled: (shares - unstaked) * kaminoFarmsStakeScale,
      }),
    })
    expect(() =>
      validateKaminoTransaction({ transaction, intent: withdrawIntent(shares, unstaked), lookupTables })
    ).not.toThrow()
  })

  it('refuses an unstake that releases more than the shortfall', () => {
    const shares = 1_500_000n
    const unstaked = 900_000n
    const { transaction, lookupTables } = buildTestTransaction({
      owner: testOwner,
      descriptor: steakhouseUsdc,
      withFarmUserState: true,
      instructions: stakedWithdrawInstructions({
        shares,
        unstakeScaled: shares * kaminoFarmsStakeScale,
      }),
    })
    expect(
      finding(() => validateKaminoTransaction({ transaction, intent: withdrawIntent(shares, unstaked), lookupTables }))
    ).toBe('amountMismatch')
  })

  it('refuses a farm release when the request fits the unstaked balance', () => {
    const { transaction, lookupTables } = buildTestTransaction({
      owner: testOwner,
      descriptor: steakhouseUsdc,
      withFarmUserState: true,
      instructions: stakedWithdrawInstructions({
        shares: 500_000n,
        unstakeScaled: 1n * kaminoFarmsStakeScale,
      }),
    })
    // The intent says no unstake is needed, so the farms pair is not in the
    // template and the walk fails at the required vault withdraw.
    expect(
      finding(() =>
        validateKaminoTransaction({ transaction, intent: withdrawIntent(500_000n, 500_000n), lookupTables })
      )
    ).toBe('missingInstruction')
  })

  it('refuses the withdraw-everything sentinel arriving in the instruction', () => {
    const { transaction, lookupTables } = buildTestTransaction({
      owner: testOwner,
      descriptor: steakhouseUsdc,
      instructions: withdrawInstruction(2n ** 64n - 1n),
    })
    expect(
      finding(() =>
        validateKaminoTransaction({ transaction, intent: withdrawIntent(500_000n, 500_000n), lookupTables })
      )
    ).toBe('amountMismatch')
  })

  it('refuses a withdraw paying out to an account the user does not own', () => {
    const stranger = Keypair.generate().publicKey.toBase58()
    const { transaction, lookupTables } = buildTestTransaction({
      owner: testOwner,
      descriptor: steakhouseUsdc,
      extraStaticReadonly: [stranger],
      instructions: indexes => {
        const [withdraw] = withdrawInstruction(500_000n)(indexes)
        withdraw.accountKeyIndexes[5] = indexes.program(stranger)
        return [withdraw]
      },
    })
    expect(
      finding(() =>
        validateKaminoTransaction({ transaction, intent: withdrawIntent(500_000n, 500_000n), lookupTables })
      )
    ).toBe('accountNotOwnedByUser')
  })
})

describe('validateKaminoTransaction: shape', () => {
  it('refuses a program outside the allow-list', () => {
    const foreign = Keypair.generate().publicKey.toBase58()
    const { transaction, lookupTables } = buildTestTransaction({
      owner: testOwner,
      descriptor: steakhouseUsdc,
      extraStaticReadonly: [foreign],
      instructions: indexes => [
        ...depositInstructions(1_000_000n)(indexes),
        { program: foreign, accountKeyIndexes: [indexes.owner], data: new Uint8Array([1]) },
      ],
    })
    expect(
      finding(() => validateKaminoTransaction({ transaction, intent: depositIntent(1_000_000n), lookupTables }))
    ).toBe('programNotAllowed')
  })

  it('refuses a memo whose payload is not exactly the tag', () => {
    const { transaction, lookupTables } = buildTestTransaction({
      owner: testOwner,
      descriptor: steakhouseUsdc,
      extraStaticReadonly: [kaminoAllowedPrograms.memo],
      instructions: indexes => [
        ...depositInstructions(1_000_000n)(indexes),
        {
          program: kaminoAllowedPrograms.memo,
          accountKeyIndexes: [],
          data: new TextEncoder().encode('8k2mz extra'),
        },
      ],
    })
    const intent: KaminoTransactionIntent = { ...depositIntent(1_000_000n), carriesAttributionMemo: true }
    // The program is allow-listed but the payload is no instruction the
    // template names, so the required attribution memo goes unmatched.
    expect(finding(() => validateKaminoTransaction({ transaction, intent, lookupTables }))).toBe('missingInstruction')
  })

  it('refuses a vault info whose descriptor is not the registry object', () => {
    const { transaction, lookupTables } = buildTestTransaction({
      owner: testOwner,
      descriptor: steakhouseUsdc,
      instructions: depositInstructions(1_000_000n),
    })
    const intent: KaminoTransactionIntent = {
      ...depositIntent(1_000_000n),
      vault: { ...vault, descriptor: { ...steakhouseUsdc } },
    }
    expect(finding(() => validateKaminoTransaction({ transaction, intent, lookupTables }))).toBe(
      'vaultDescriptorMismatch'
    )
  })
})

describe('validateKaminoTransaction: writable accounts', () => {
  it('refuses a writable account nothing references', () => {
    // A loaded write privilege with no purpose is not a shape any legitimate
    // builder emits: the farm user state rides as a writable static key here
    // while no instruction touches it.
    const { transaction, lookupTables } = buildTestTransaction({
      owner: testOwner,
      descriptor: steakhouseUsdc,
      instructions: depositInstructions(1_000_000n),
      withFarmUserState: true,
    })
    expect(
      finding(() => validateKaminoTransaction({ transaction, intent: depositIntent(1_000_000n), lookupTables }))
    ).toBe('unreferencedWritableAccount')
  })

  it('refuses a builder-composed instruction writing an account the operation cannot name', () => {
    // The ATA creation's checked prefix is clean — payer, owner, mint and the
    // derived address all pass — but a writable trailing account outside the
    // explained set rides along. That is where a drain would have to write.
    const { transaction, lookupTables } = buildTestTransaction({
      owner: testOwner,
      descriptor: steakhouseUsdc,
      extraStaticReadonly: [kaminoAllowedPrograms.associatedToken, kaminoAllowedPrograms.token],
      instructions: indexes => [
        {
          program: kaminoAllowedPrograms.associatedToken,
          accountKeyIndexes: [
            indexes.owner,
            indexes.userShareAccount,
            indexes.owner,
            indexes.sharesMint,
            indexes.spare,
            indexes.program(kaminoAllowedPrograms.token),
            indexes.vaultState,
          ],
          data: Uint8Array.from([1]),
        },
        ...depositInstructions(1_000_000n)(indexes),
      ],
    })
    expect(
      finding(() => validateKaminoTransaction({ transaction, intent: depositIntent(1_000_000n), lookupTables }))
    ).toBe('unattributableWritableAccount')
  })
})
