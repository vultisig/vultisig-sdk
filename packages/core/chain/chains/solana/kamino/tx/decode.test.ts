import { Keypair, PublicKey } from '@solana/web3.js'
import { describe, expect, it } from 'vitest'

import { kaminoConfig } from '../config'
import { kaminoVaultRegistry } from '../registry'
import {
  anchorU64Data,
  buildTestTransaction,
  depositInstructions,
  stakedWithdrawInstructions,
  TestAccountIndexes,
  TestInstruction,
  testOwner,
  withdrawInstruction,
} from './__tests__/txTestKit'
import {
  decodeKaminoRawTransactions,
  decodeKaminoTransaction,
  kaminoDecodedAmountString,
  mentionsKaminoVaultProgram,
  withdrawsEntireKaminoPosition,
} from './decode'
import { kaminoAllowedPrograms, kaminoDiscriminators, kaminoFarmsStakeScale } from './instructions'
import { injectKaminoAttributionMemo, injectKaminoComputeBudget, serializeKaminoWireTransaction } from './wire'

const [steakhouseUsdc] = kaminoVaultRegistry

describe('decodeKaminoTransaction', () => {
  it('reads a deposit back out of the bytes, identifying the vault by the share account', () => {
    const { transaction } = buildTestTransaction({
      owner: testOwner,
      descriptor: steakhouseUsdc,
      instructions: depositInstructions(1_000_000n),
    })

    const decoded = decodeKaminoTransaction(transaction)

    expect(decoded).toMatchObject({
      operation: 'deposit',
      descriptor: steakhouseUsdc,
      amountBaseUnits: 1_000_000n,
      signer: testOwner,
      strandsWrappedSolRent: false,
    })
    expect(kaminoDecodedAmountString(decoded!)).toBe('1')
  })

  it('decodes both withdraw discriminators to the same claim', () => {
    for (const discriminator of [
      kaminoDiscriminators.kvaultWithdraw,
      kaminoDiscriminators.kvaultWithdrawFromAvailable,
    ]) {
      const { transaction } = buildTestTransaction({
        owner: testOwner,
        descriptor: steakhouseUsdc,
        instructions: withdrawInstruction(500_000n, discriminator),
      })

      const decoded = decodeKaminoTransaction(transaction)

      expect(decoded).toMatchObject({ operation: 'withdraw', amountBaseUnits: 500_000n, descriptor: steakhouseUsdc })
      expect(kaminoDecodedAmountString(decoded!)).toBe('0.5')
    }
  })

  it('decodes the farm-staked withdraw and reads the injected fee back out', () => {
    const { transaction } = buildTestTransaction({
      owner: testOwner,
      descriptor: steakhouseUsdc,
      withFarmUserState: true,
      instructions: stakedWithdrawInstructions({
        shares: 1_500_000n,
        unstakeScaled: 600_000n * kaminoFarmsStakeScale,
      }),
    })
    const complete = injectKaminoAttributionMemo(
      injectKaminoComputeBudget({ transaction, unitLimit: 400_000, unitPriceMicroLamports: 20_000n })
    )

    const decoded = decodeKaminoTransaction(complete)

    expect(decoded).toMatchObject({
      operation: 'withdraw',
      amountBaseUnits: 1_500_000n,
      priorityFee: { unitLimit: 400_000, unitPriceMicroLamports: 20_000n },
    })
  })

  it('refuses an unstake that releases more shares than the withdraw burns', () => {
    const { transaction } = buildTestTransaction({
      owner: testOwner,
      descriptor: steakhouseUsdc,
      withFarmUserState: true,
      instructions: stakedWithdrawInstructions({
        shares: 500_000n,
        unstakeScaled: 600_000n * kaminoFarmsStakeScale,
      }),
    })
    expect(decodeKaminoTransaction(transaction)).toBeUndefined()
  })

  it('refuses a fee outside the range this app produces', () => {
    const { transaction } = buildTestTransaction({
      owner: testOwner,
      descriptor: steakhouseUsdc,
      instructions: depositInstructions(1_000_000n),
    })
    const overpriced = injectKaminoComputeBudget({
      transaction,
      unitLimit: 320_000,
      unitPriceMicroLamports: 2_000_000n,
    })
    expect(decodeKaminoTransaction(overpriced)).toBeUndefined()
  })

  it('refuses a transaction with an instruction the template does not name', () => {
    const stranger = Keypair.generate().publicKey.toBase58()
    const { transaction } = buildTestTransaction({
      owner: testOwner,
      descriptor: steakhouseUsdc,
      extraStaticReadonly: [stranger],
      instructions: indexes => [
        ...depositInstructions(1_000_000n)(indexes),
        { program: stranger, accountKeyIndexes: [indexes.owner], data: new Uint8Array([9]) },
      ],
    })
    expect(decodeKaminoTransaction(transaction)).toBeUndefined()
  })

  it('refuses two kvault instructions rather than guessing which to describe', () => {
    const { transaction } = buildTestTransaction({
      owner: testOwner,
      descriptor: steakhouseUsdc,
      instructions: indexes => [...withdrawInstruction(1n)(indexes), ...withdrawInstruction(2n)(indexes)],
    })
    expect(decodeKaminoTransaction(transaction)).toBeUndefined()
  })

  it('flags the withdraw-everything sentinel instead of rendering it as a count', () => {
    const { transaction } = buildTestTransaction({
      owner: testOwner,
      descriptor: steakhouseUsdc,
      instructions: withdrawInstruction(2n ** 64n - 1n),
    })
    const decoded = decodeKaminoTransaction(transaction)
    expect(decoded).toBeDefined()
    expect(withdrawsEntireKaminoPosition(decoded!)).toBe(true)
  })
})

describe('decodeKaminoRawTransactions', () => {
  it('accepts exactly one parseable transaction and refuses a batch', () => {
    const { transaction } = buildTestTransaction({
      owner: testOwner,
      descriptor: steakhouseUsdc,
      instructions: depositInstructions(1_000_000n),
    })
    const raw = serializeKaminoWireTransaction(transaction)

    expect(decodeKaminoRawTransactions([raw])?.operation).toBe('deposit')
    expect(decodeKaminoRawTransactions([raw, raw])).toBeUndefined()
    expect(decodeKaminoRawTransactions([])).toBeUndefined()
  })
})

describe('mentionsKaminoVaultProgram', () => {
  it('finds the program key in bytes this module cannot parse', () => {
    const needle = Buffer.from(new Keypair().publicKey.toBytes())
    const programBytes = Buffer.from(
      serializeKaminoWireTransaction(
        buildTestTransaction({
          owner: testOwner,
          descriptor: steakhouseUsdc,
          instructions: depositInstructions(1n),
        }).transaction
      ),
      'base64'
    )

    expect(mentionsKaminoVaultProgram(programBytes.toString('base64'))).toBe(true)
    expect(mentionsKaminoVaultProgram(needle.toString('base64'))).toBe(false)
    expect(mentionsKaminoVaultProgram('')).toBe(false)
  })

  it('is a byte scan, so a legacy-format payload cannot escape it', () => {
    const programKey = Buffer.from(new PublicKey(kaminoConfig.programId).toBytes())
    const legacyish = Buffer.concat([Buffer.from([1, 2, 3]), programKey, Buffer.from([4, 5])])
    expect(mentionsKaminoVaultProgram(legacyish.toString('base64'))).toBe(true)
  })
})

describe('decodeKaminoTransaction: wrapped-SOL deposit', () => {
  const [, , allezSol] = kaminoVaultRegistry
  const strayAccount = Keypair.generate().publicKey.toBase58()

  const systemTransferData = (lamports: bigint): Uint8Array => {
    const data = new Uint8Array(12)
    data[0] = 2
    new DataView(data.buffer).setBigUint64(4, lamports, true)
    return data
  }

  const wrappedDeposit = (syncedAccount?: (indexes: { program: (address: string) => number }) => number) =>
    buildTestTransaction({
      owner: testOwner,
      descriptor: allezSol,
      extraStaticReadonly: [kaminoAllowedPrograms.system, kaminoAllowedPrograms.token, strayAccount],
      instructions: indexes => [
        {
          program: kaminoAllowedPrograms.system,
          accountKeyIndexes: [indexes.owner, indexes.userTokenAccount],
          data: systemTransferData(1_000_000n),
        },
        {
          program: kaminoAllowedPrograms.token,
          accountKeyIndexes: [syncedAccount ? syncedAccount(indexes) : indexes.userTokenAccount],
          data: Uint8Array.from([17]),
        },
        ...depositInstructions(1_000_000n)(indexes),
      ],
    }).transaction

  it('decodes the wrap, sync and deposit as one claim and flags the stranded rent', () => {
    const decoded = decodeKaminoTransaction(wrappedDeposit())
    expect(decoded).toMatchObject({
      operation: 'deposit',
      descriptor: allezSol,
      amountBaseUnits: 1_000_000n,
      strandsWrappedSolRent: true,
    })
  })

  it('refuses a sync aimed at an account that is not the signer wrapped-SOL account', () => {
    // The derivation needs no network, so a co-signing device refuses this
    // exactly like the initiating validator would.
    const decoded = decodeKaminoTransaction(wrappedDeposit(indexes => indexes.program(strayAccount)))
    expect(decoded).toBeUndefined()
  })
})

describe('decodeKaminoTransaction: farm instruction bindings', () => {
  const strayFarm = Keypair.generate().publicKey.toBase58()

  /** A deposit plus a farms instruction whose accounts the caller chooses. */
  const depositWith = (farmsInstruction: (indexes: TestAccountIndexes) => TestInstruction) =>
    buildTestTransaction({
      owner: testOwner,
      descriptor: steakhouseUsdc,
      extraStaticReadonly: [strayFarm],
      instructions: indexes => [...depositInstructions(1_000_000n)(indexes).slice(0, 1), farmsInstruction(indexes)],
    }).transaction

  const stake = (accountKeyIndexes: number[]): TestInstruction => ({
    program: kaminoAllowedPrograms.farms,
    accountKeyIndexes,
    data: anchorU64Data(kaminoDiscriminators.farmsStake, 2n ** 64n - 1n),
  })

  const initializeUser = (accountKeyIndexes: number[]): TestInstruction => ({
    program: kaminoAllowedPrograms.farms,
    accountKeyIndexes,
    data: kaminoDiscriminators.farmsInitializeUser.slice(),
  })

  const stakeSlots = (indexes: TestAccountIndexes) => [
    indexes.owner,
    indexes.vaultState,
    indexes.farm,
    indexes.spare,
    indexes.userShareAccount,
    indexes.sharesMint,
  ]

  it('decodes a stake that names the signer, this vault farm and the deposit share account', () => {
    expect(decodeKaminoTransaction(depositWith(indexes => stake(stakeSlots(indexes))))).toMatchObject({
      operation: 'deposit',
      amountBaseUnits: 1_000_000n,
    })
  })

  it('refuses a stake authorised by someone other than the signer', () => {
    const transaction = depositWith(indexes => stake([indexes.userTokenAccount, ...stakeSlots(indexes).slice(1)]))
    expect(decodeKaminoTransaction(transaction)).toBeUndefined()
  })

  it('refuses a stake into a farm that is not this vault own', () => {
    // A farm belonging to somewhere else parks the position where this app
    // never reads it. The slot resolves statically here, so the offline
    // decode must catch it rather than defer to the initiating validator.
    const transaction = depositWith(indexes => {
      const slots = stakeSlots(indexes)
      slots[2] = indexes.program(strayFarm)
      return stake(slots)
    })
    expect(decodeKaminoTransaction(transaction)).toBeUndefined()
  })

  it('refuses a stake crediting a share account other than the one the deposit filled', () => {
    const transaction = depositWith(indexes => {
      const slots = stakeSlots(indexes)
      slots[4] = indexes.userTokenAccount
      return stake(slots)
    })
    expect(decodeKaminoTransaction(transaction)).toBeUndefined()
  })

  it('refuses a farm user initialization for another authority or another farm', () => {
    const slots = (indexes: TestAccountIndexes) => [
      indexes.owner,
      indexes.spare,
      indexes.spare,
      indexes.spare,
      indexes.spare,
      indexes.farm,
    ]

    const wrongAuthority = buildTestTransaction({
      owner: testOwner,
      descriptor: steakhouseUsdc,
      extraStaticReadonly: [strayFarm],
      instructions: indexes => [
        ...depositInstructions(1_000_000n)(indexes).slice(0, 1),
        initializeUser([indexes.userTokenAccount, ...slots(indexes).slice(1)]),
        stake(stakeSlots(indexes)),
      ],
    }).transaction
    expect(decodeKaminoTransaction(wrongAuthority)).toBeUndefined()

    const wrongFarm = buildTestTransaction({
      owner: testOwner,
      descriptor: steakhouseUsdc,
      extraStaticReadonly: [strayFarm],
      instructions: indexes => [
        ...depositInstructions(1_000_000n)(indexes).slice(0, 1),
        initializeUser([...slots(indexes).slice(0, 5), indexes.program(strayFarm)]),
        stake(stakeSlots(indexes)),
      ],
    }).transaction
    expect(decodeKaminoTransaction(wrongFarm)).toBeUndefined()
  })
})
