import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { Keypair, MessageV0, PublicKey, VersionedTransaction } from '@solana/web3.js'

import { kaminoShareAmount, kaminoTokenAmount } from '../../amount'
import { KaminoVaultInfo } from '../../models'
import { parseKaminoRate } from '../../rate'
import { KaminoVaultDescriptor } from '../../registry'
import { deriveKaminoFarmsUserState, kaminoAllowedPrograms, kaminoDiscriminators } from '../instructions'

/**
 * Builders for the synthetic vault transactions the pipeline tests drive:
 * offline reconstructions of the shapes the build endpoints emit, at the
 * account layouts pinned in `kaminoInstructionAccounts`, with the vault's
 * accounts loaded through an address lookup table the way live transactions
 * load them.
 */

/** A fixed signer for the whole suite, so derived ATAs stay stable. */
export const testOwner = Keypair.generate().publicKey.toBase58()

/** A lookup-table address standing in for the vault's own table. */
export const testLookupTableAddress = Keypair.generate().publicKey.toBase58()

const filler = Keypair.generate().publicKey.toBase58()

/** The owner's ATA under the classic token program. */
export const testAta = (owner: string, mint: string): string =>
  getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(owner), false, TOKEN_PROGRAM_ID).toBase58()

/** A minimal hydrated vault-info fixture over the registry descriptor. */
export const testVaultInfo = (descriptor: KaminoVaultDescriptor): KaminoVaultInfo => ({
  descriptor,
  name: descriptor.fallbackName,
  minDeposit: kaminoTokenAmount(1n, descriptor.tokenDecimals),
  minWithdraw: kaminoShareAmount(1n, descriptor.sharesDecimals),
  lookupTable: testLookupTableAddress,
  apy30d: 0.04,
  tokensPerShare: parseKaminoRate('1')!,
  tokenPriceUsd: 1,
  tokensAvailable: undefined,
})

/** Anchor payload: 8-byte discriminator + little-endian u64 argument. */
export const anchorU64Data = (discriminator: Uint8Array, value: bigint): Uint8Array => {
  const data = new Uint8Array(16)
  data.set(discriminator, 0)
  new DataView(data.buffer).setBigUint64(8, value, true)
  return data
}

/** Anchor payload: 8-byte discriminator + little-endian u128 argument. */
export const anchorU128Data = (discriminator: Uint8Array, value: bigint): Uint8Array => {
  const data = new Uint8Array(24)
  data.set(discriminator, 0)
  let remaining = value
  for (let offset = 8; offset < 24; offset++) {
    data[offset] = Number(remaining & 0xffn)
    remaining >>= 8n
  }
  return data
}

export type TestInstruction = {
  program: string
  accountKeyIndexes: number[]
  data: Uint8Array
}

type BuildTransactionInput = {
  owner: string
  descriptor: KaminoVaultDescriptor
  instructions: (indexes: TestAccountIndexes) => TestInstruction[]
  /** Extra static keys appended to the read-only unsigned tail. */
  extraStaticReadonly?: string[]
  /** Include the derived farms user state as a writable static key. */
  withFarmUserState?: boolean
}

/**
 * Runtime account indexes the instruction builders address. Static region:
 * owner, the two ATAs, optionally the farm user state, then program keys.
 * Lookup region: the vault and its writable state first, then the read-only
 * mints, farm and one spare account — mirroring how the builder loads
 * everything vault-side through the table.
 */
export type TestAccountIndexes = {
  owner: number
  userTokenAccount: number
  userShareAccount: number
  farmUserState: number
  program: (address: string) => number
  vault: number
  vaultState: number
  tokenMint: number
  sharesMint: number
  farm: number
  spare: number
}

/**
 * Compiles a v0 transaction over the standard test account arrangement and
 * returns it with the lookup-table contents the validator resolves against.
 */
export const buildTestTransaction = ({
  owner,
  descriptor,
  instructions,
  extraStaticReadonly = [],
  withFarmUserState = false,
}: BuildTransactionInput): { transaction: VersionedTransaction; lookupTables: Record<string, string[]> } => {
  const userTokenAccount = testAta(owner, descriptor.tokenMint)
  const userShareAccount = testAta(owner, descriptor.sharesMint)
  const farmUserState = withFarmUserState ? deriveKaminoFarmsUserState({ farm: descriptor.farm!, owner })! : undefined

  const writableStatics = [owner, userTokenAccount, userShareAccount, ...(farmUserState ? [farmUserState] : [])]
  const programKeys = [kaminoAllowedPrograms.kvault, kaminoAllowedPrograms.farms, ...extraStaticReadonly]
  const staticKeys = [...writableStatics, ...programKeys]
  const staticCount = staticKeys.length

  const table = [descriptor.address, filler, descriptor.tokenMint, descriptor.sharesMint, descriptor.farm!, filler]
  const writableIndexes = [0, 1]
  const readonlyIndexes = [2, 3, 4, 5]

  const indexes: TestAccountIndexes = {
    owner: 0,
    userTokenAccount: 1,
    userShareAccount: 2,
    farmUserState: farmUserState ? 3 : -1,
    program: address => {
      const index = staticKeys.indexOf(address)
      if (index === -1) throw new Error(`program ${address} is not a static key`)
      return index
    },
    vault: staticCount + 0,
    vaultState: staticCount + 1,
    tokenMint: staticCount + 2,
    sharesMint: staticCount + 3,
    farm: staticCount + 4,
    spare: staticCount + 5,
  }

  const compiled = instructions(indexes).map(instruction => ({
    programIdIndex: indexes.program(instruction.program),
    accountKeyIndexes: instruction.accountKeyIndexes,
    data: instruction.data,
  }))

  const message = new MessageV0({
    header: {
      numRequiredSignatures: 1,
      numReadonlySignedAccounts: 0,
      numReadonlyUnsignedAccounts: programKeys.length,
    },
    staticAccountKeys: staticKeys.map(key => new PublicKey(key)),
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
    compiledInstructions: compiled,
    addressTableLookups: [{ accountKey: new PublicKey(testLookupTableAddress), writableIndexes, readonlyIndexes }],
  })

  return {
    transaction: new VersionedTransaction(message),
    lookupTables: { [testLookupTableAddress]: table },
  }
}

/** A deposit-shaped instruction list: kvault deposit + farm stake. */
export const depositInstructions =
  (amount: bigint) =>
  (indexes: TestAccountIndexes): TestInstruction[] => [
    {
      program: kaminoAllowedPrograms.kvault,
      accountKeyIndexes: [
        indexes.owner,
        indexes.vault,
        indexes.vaultState,
        indexes.tokenMint,
        indexes.spare,
        indexes.sharesMint,
        indexes.userTokenAccount,
        indexes.userShareAccount,
      ],
      data: anchorU64Data(kaminoDiscriminators.kvaultDeposit, amount),
    },
    {
      program: kaminoAllowedPrograms.farms,
      accountKeyIndexes: [
        indexes.owner,
        indexes.vaultState,
        indexes.farm,
        indexes.spare,
        indexes.userShareAccount,
        indexes.sharesMint,
      ],
      data: anchorU64Data(kaminoDiscriminators.farmsStake, 2n ** 64n - 1n),
    },
  ]

/** A plain withdraw: one kvault instruction, either discriminator. */
export const withdrawInstruction =
  (shares: bigint, discriminator: Uint8Array = kaminoDiscriminators.kvaultWithdrawFromAvailable) =>
  (indexes: TestAccountIndexes): TestInstruction[] => [
    {
      program: kaminoAllowedPrograms.kvault,
      accountKeyIndexes: [
        indexes.owner,
        indexes.vault,
        indexes.vaultState,
        indexes.spare,
        indexes.vaultState,
        indexes.userTokenAccount,
        indexes.tokenMint,
        indexes.userShareAccount,
        indexes.sharesMint,
      ],
      data: anchorU64Data(discriminator, shares),
    },
  ]

/** A farm-staked withdraw: unstake + release, then the vault withdraw. */
export const stakedWithdrawInstructions =
  ({ shares, unstakeScaled }: { shares: bigint; unstakeScaled: bigint }) =>
  (indexes: TestAccountIndexes): TestInstruction[] => [
    {
      program: kaminoAllowedPrograms.farms,
      accountKeyIndexes: [indexes.owner, indexes.farmUserState, indexes.farm],
      data: anchorU128Data(kaminoDiscriminators.farmsUnstake, unstakeScaled),
    },
    {
      program: kaminoAllowedPrograms.farms,
      accountKeyIndexes: [indexes.owner, indexes.farmUserState, indexes.farm, indexes.userShareAccount],
      data: kaminoDiscriminators.farmsWithdrawUnstakedDeposits.slice(),
    },
    ...withdrawInstruction(shares, kaminoDiscriminators.kvaultWithdraw)(indexes),
  ]
