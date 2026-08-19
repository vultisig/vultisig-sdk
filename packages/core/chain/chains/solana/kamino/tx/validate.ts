import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { PublicKey, VersionedTransaction } from '@solana/web3.js'

import { KaminoShareAmount, kaminoShareAmount, KaminoTokenAmount } from '../amount'
import { kaminoMaxBaseUnits } from '../baseUnits'
import { kaminoConfig } from '../config'
import { KaminoVaultInfo } from '../models'
import { getKaminoVaultDescriptor } from '../registry'
import {
  anchorU64Argument,
  anchorU128Argument,
  computeUnitLimitArgument,
  computeUnitPriceArgument,
  deriveKaminoFarmsUserState,
  hasNoAnchorArgument,
  isAttributionMemoData,
  isBuilderComposedProgram,
  KaminoAllowedProgram,
  kaminoAllowedProgram,
  kaminoAllowedPrograms,
  kaminoFarmsStakeScale,
  kaminoInstructionAccounts,
  systemTransferLamports,
} from './instructions'
import {
  expectedKaminoSequence,
  KaminoInstructionKind,
  kaminoInstructionKind,
  kaminoInstructionKindName,
  matchKaminoSequence,
} from './sequence'
import {
  isKaminoAccountWritable,
  isUnsignedSingleSigner,
  resolveKaminoAccountAddresses,
  resolveKaminoLookupTables,
  totalKaminoAccountCount,
} from './wire'

/**
 * A withdraw request, split the way the transaction that answers it is built.
 *
 * One type rather than a share amount plus a loose second parameter, because
 * the split is not optional information: the withdraw endpoint builds a plain
 * transaction when the request fits inside the shares already in the user's
 * own account, and one with `farms::unstake` and
 * `farms::withdraw_unstaked_deposits` in front when it does not. Which of
 * those two it will be is decided entirely by `shares` against
 * `unstakedShares`, so a caller that could not state the split could not say
 * which transaction it was expecting, and would have to accept either.
 */
export type KaminoWithdrawRequest = {
  /** Shares the vault withdraw burns — the `u64` in the instruction. */
  shares: KaminoShareAmount
  /**
   * Shares already sitting in the user's share account when the position was
   * read — the part a withdraw spends without touching the farm.
   */
  unstakedShares: KaminoShareAmount
}

/**
 * Shares the farm has to release before the withdraw can burn its amount:
 * the shortfall, and nothing more. Measured against captured builds: a
 * request covered by the unstaked balance is built with no farms
 * instructions at all, and anything above it unstakes exactly the
 * difference.
 */
export const kaminoUnstakeShares = ({ shares, unstakedShares }: KaminoWithdrawRequest): KaminoShareAmount => {
  const shortfall = shares.baseUnits - unstakedShares.baseUnits
  return kaminoShareAmount(shortfall > 0n ? shortfall : 0n, shares.decimals)
}

/** The operation a built transaction is supposed to perform. */
export type KaminoOperationIntent = { deposit: KaminoTokenAmount } | { withdraw: KaminoWithdrawRequest }

/**
 * The priority fee the app injected: a compute unit limit and a price per
 * unit. The fee the network charges is `limit × price`, paid in SOL by the
 * fee payer, so both halves are a spend and both are checked against the
 * values the app chose rather than accepted from the transaction.
 */
export type KaminoPriorityFee = {
  unitLimit: number
  unitPriceMicroLamports: bigint
}

/** The request a built transaction is supposed to be the answer to. */
export type KaminoTransactionIntent = {
  operation: KaminoOperationIntent
  vault: KaminoVaultInfo
  /**
   * The user's Solana address: fee payer, sole signer, and the account every
   * destination must belong to.
   */
  owner: string
  /**
   * The priority fee the app injected, or `undefined` before injection — in
   * which case any ComputeBudget instruction at all is a refusal, because
   * Kamino's builder emits none and a fee we did not choose is SOL leaving
   * the wallet.
   */
  priorityFee?: KaminoPriorityFee
  /**
   * Whether the app has appended its attribution memo. `false` before
   * injection, where a memo can only have come from the response — and the
   * Memo program logs whatever it is handed, so a memo we did not write is
   * text this app would be signing on somebody else's behalf.
   */
  carriesAttributionMemo: boolean
}

/** The category a validation refusal falls into, for branching and tests. */
export type KaminoValidationFinding =
  | 'vaultNotAllowed'
  | 'vaultDescriptorMismatch'
  | 'transactionShape'
  | 'unexpectedLookupTable'
  | 'accountResolution'
  | 'programNotAllowed'
  | 'unexpectedInstruction'
  | 'missingInstruction'
  | 'instructionNotForOperation'
  | 'malformedInstruction'
  | 'accountMismatch'
  | 'accountNotOwnedByUser'
  | 'amountMismatch'
  | 'amountOutOfRange'
  | 'unexpectedPriorityFee'
  | 'unexpectedMemo'
  | 'unattributableWritableAccount'
  | 'unreferencedWritableAccount'
  | 'derivationFailed'

/**
 * A refusal from the fail-closed validator. Everything it finds is a refusal
 * — nothing downgrades to a warning — and `finding` names the category so
 * callers and tests branch on data rather than message text.
 */
export class KaminoValidationError extends Error {
  readonly finding: KaminoValidationFinding

  constructor(finding: KaminoValidationFinding, detail: string) {
    super(`Kamino transaction refused (${finding}): ${detail}`)
    this.name = 'KaminoValidationError'
    this.finding = finding
  }
}

const refuse = (finding: KaminoValidationFinding, detail: string): never => {
  throw new KaminoValidationError(finding, detail)
}

/**
 * The user's associated token accounts for one mint, one per token program.
 * Both token programs are tried because a mint belongs to exactly one and
 * which one is not knowable from the address alone.
 */
export const kaminoUserTokenAccounts = ({ owner, mint }: { owner: string; mint: string }): Set<string> => {
  try {
    const ownerKey = new PublicKey(owner)
    const mintKey = new PublicKey(mint)
    return new Set(
      [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].map(program =>
        getAssociatedTokenAddressSync(mintKey, ownerKey, false, program).toBase58()
      )
    )
  } catch {
    return new Set()
  }
}

type Context = {
  intent: KaminoTransactionIntent
  transaction: VersionedTransaction
  /** Every account the message addresses, in runtime index order. */
  accounts: string[]
  /** The allow-list name of each instruction's program, else `undefined`. */
  programs: (KaminoAllowedProgram | undefined)[]
  userTokenAccounts: Set<string>
  userShareAccounts: Set<string>
  /**
   * Every account this operation can name — the set a builder-composed
   * instruction's writes must fall inside.
   */
  explainedAccounts: Set<string>
}

const instructionAccounts = (context: Context, position: number): string[] =>
  Array.from(context.transaction.message.compiledInstructions[position].accountKeyIndexes, index => {
    const address = context.accounts[index]
    return address ?? refuse('accountResolution', `instruction ${position} indexes account ${index}`)
  })

const requireOwner = (context: Context, account: string, role: string) => {
  if (account !== context.intent.owner) {
    refuse('accountMismatch', `${role} is ${account}, expected ${context.intent.owner}`)
  }
}

const requireAccount = (account: string, expected: string, role: string) => {
  if (account !== expected) refuse('accountMismatch', `${role} is ${account}, expected ${expected}`)
}

const requireUserTokenAccount = (context: Context, account: string, role: string) => {
  if (!context.userTokenAccounts.has(account)) refuse('accountNotOwnedByUser', `${role} ${account}`)
}

const requireUserShareAccount = (context: Context, account: string, role: string) => {
  if (!context.userShareAccounts.has(account)) refuse('accountNotOwnedByUser', `${role} ${account}`)
}

const requireFarm = (context: Context, account: string) => {
  const farm = context.intent.vault.descriptor.farm
  if (!farm) refuse('instructionNotForOperation', 'farm instruction against a farmless vault')
  else requireAccount(account, farm, 'farm')
}

const requireFarmUserState = (context: Context, account: string) => {
  const farm = context.intent.vault.descriptor.farm
  if (!farm) return refuse('instructionNotForOperation', 'farm instruction against a farmless vault')
  const expected = deriveKaminoFarmsUserState({ farm, owner: context.intent.owner })
  if (!expected) return refuse('derivationFailed', `the farm user state for ${farm}`)
  requireAccount(account, expected, 'farm user state')
}

const requireNoAccounts = (accounts: string[], position: number, detail: string) => {
  if (accounts.length > 0) refuse('malformedInstruction', `instruction ${position}: ${detail} takes no accounts`)
}

const requireU64 = (value: bigint, role: string): bigint => {
  if (value < 0n || value > kaminoMaxBaseUnits) refuse('amountOutOfRange', `${role} ${value}`)
  return value
}

const requireAnchorAmount = (data: Uint8Array, position: number, expected: bigint, role: string) => {
  const argument = anchorU64Argument(data)
  if (argument === undefined) {
    return refuse('malformedInstruction', `instruction ${position}: ${role} argument`)
  }
  if (argument !== requireU64(expected, role)) {
    refuse('amountMismatch', `${role} is ${argument}, expected ${expected}`)
  }
}

const operationKind = (intent: KaminoTransactionIntent): 'deposit' | 'withdraw' =>
  'deposit' in intent.operation ? 'deposit' : 'withdraw'

const validateInstruction = (context: Context, kind: KaminoInstructionKind, position: number) => {
  const data = context.transaction.message.compiledInstructions[position].data
  const accounts = instructionAccounts(context, position)
  const { intent } = context
  const layout = kaminoInstructionAccounts

  const requireMinimumAccounts = (minimum: number) => {
    if (accounts.length < minimum) {
      refuse(
        'malformedInstruction',
        `instruction ${position}: ${kaminoInstructionKindName[kind]} needs ${minimum} accounts`
      )
    }
  }

  switch (kind) {
    case 'computeUnitLimit': {
      requireNoAccounts(accounts, position, 'compute budget')
      const limit = computeUnitLimitArgument(data)
      const fee = intent.priorityFee
      if (!fee || limit === undefined) {
        return refuse('malformedInstruction', `instruction ${position}: compute unit limit`)
      }
      // A limit is half of the fee: the network charges `limit × price`, so a
      // limit raised beyond what the transaction needs is SOL spent for nothing.
      if (limit !== fee.unitLimit) {
        refuse('amountMismatch', `compute unit limit is ${limit}, expected ${fee.unitLimit}`)
      }
      return
    }

    case 'computeUnitPrice': {
      requireNoAccounts(accounts, position, 'compute budget')
      const price = computeUnitPriceArgument(data)
      const fee = intent.priorityFee
      if (!fee || price === undefined) {
        return refuse('malformedInstruction', `instruction ${position}: compute unit price`)
      }
      // This is the half an attacker would inflate: a u64 of micro-lamports,
      // and nothing on chain caps the resulting fee below the payer's balance.
      if (price !== fee.unitPriceMicroLamports) {
        refuse('amountMismatch', `compute unit price is ${price}, expected ${fee.unitPriceMicroLamports}`)
      }
      return
    }

    case 'createTokenAccount': {
      // A CreateIdempotent may only create one of the vault's two mints'
      // accounts, for the user, at the address derivation says it must have.
      // Creating an account is harmless in itself, but it is also where a
      // third-party destination would first appear.
      requireMinimumAccounts(layout.associatedToken.count)
      requireOwner(context, accounts[layout.associatedToken.payer], 'token account funder')
      requireOwner(context, accounts[layout.associatedToken.wallet], 'token account owner')

      const mint = accounts[layout.associatedToken.mint]
      const { tokenMint, sharesMint } = intent.vault.descriptor
      if (mint !== tokenMint && mint !== sharesMint) {
        return refuse('accountMismatch', `created token account mint is ${mint}`)
      }

      const tokenProgramId = accounts[layout.associatedToken.tokenProgram]
      const tokenProgram =
        tokenProgramId === kaminoAllowedPrograms.token
          ? TOKEN_PROGRAM_ID
          : tokenProgramId === kaminoAllowedPrograms.token2022
            ? TOKEN_2022_PROGRAM_ID
            : undefined
      if (!tokenProgram) return refuse('programNotAllowed', `token program ${tokenProgramId}`)

      const derived = getAssociatedTokenAddressSync(
        new PublicKey(mint),
        new PublicKey(intent.owner),
        false,
        tokenProgram
      ).toBase58()
      requireAccount(accounts[layout.associatedToken.account], derived, 'created token account')
      return
    }

    case 'wrapSolTransfer': {
      // The lamports that fund the wSOL account: the only native SOL movement
      // the operation performs, so both endpoints and the amount are pinned.
      requireMinimumAccounts(layout.systemTransfer.count)
      const lamports = systemTransferLamports(data)
      if (lamports === undefined) {
        return refuse('malformedInstruction', `instruction ${position}: system transfer`)
      }
      requireOwner(context, accounts[layout.systemTransfer.source], 'SOL transfer source')
      requireUserTokenAccount(context, accounts[layout.systemTransfer.destination], 'SOL transfer destination')

      if (!('deposit' in intent.operation)) {
        return refuse('instructionNotForOperation', 'SOL wrap on a withdraw')
      }
      const expected = requireU64(intent.operation.deposit.baseUnits, 'deposit amount')
      if (lamports !== expected) {
        refuse('amountMismatch', `wrapped SOL amount is ${lamports}, expected ${expected}`)
      }
      return
    }

    case 'syncNative': {
      requireMinimumAccounts(1)
      requireUserTokenAccount(context, accounts[0], 'wrapped SOL account')
      return
    }

    case 'closeTokenAccount': {
      // Closing a token account sends its remaining lamports somewhere. Both
      // the account being closed and where its rent lands have to be the user's.
      requireMinimumAccounts(layout.closeAccount.count)
      const closed = accounts[layout.closeAccount.account]
      if (!context.userTokenAccounts.has(closed) && !context.userShareAccounts.has(closed)) {
        return refuse('accountNotOwnedByUser', `closed token account ${closed}`)
      }
      requireOwner(context, accounts[layout.closeAccount.destination], 'closed account rent destination')
      requireOwner(context, accounts[layout.closeAccount.authority], 'closed account authority')
      return
    }

    case 'kvaultDeposit': {
      requireMinimumAccounts(layout.kvaultDeposit.minimumCount)
      if (!('deposit' in intent.operation)) {
        return refuse('instructionNotForOperation', 'vault deposit on a withdraw')
      }
      requireOwner(context, accounts[layout.kvaultDeposit.user], 'deposit authority')
      requireAccount(accounts[layout.kvaultDeposit.vault], intent.vault.descriptor.address, 'vault')
      requireAccount(accounts[layout.kvaultDeposit.tokenMint], intent.vault.descriptor.tokenMint, 'deposit token mint')
      requireAccount(
        accounts[layout.kvaultDeposit.sharesMint],
        intent.vault.descriptor.sharesMint,
        'deposit shares mint'
      )
      requireUserTokenAccount(context, accounts[layout.kvaultDeposit.userTokenAccount], 'deposit source')
      requireUserShareAccount(context, accounts[layout.kvaultDeposit.userShareAccount], 'deposit share destination')
      requireAnchorAmount(data, position, intent.operation.deposit.baseUnits, 'deposit amount')
      return
    }

    case 'kvaultWithdraw': {
      requireMinimumAccounts(layout.kvaultWithdraw.minimumCount)
      if (!('withdraw' in intent.operation)) {
        return refuse('instructionNotForOperation', 'vault withdraw on a deposit')
      }
      requireOwner(context, accounts[layout.kvaultWithdraw.user], 'withdraw authority')
      requireAccount(accounts[layout.kvaultWithdraw.vault], intent.vault.descriptor.address, 'vault')
      requireAccount(
        accounts[layout.kvaultWithdraw.tokenMint],
        intent.vault.descriptor.tokenMint,
        'withdraw token mint'
      )
      requireAccount(
        accounts[layout.kvaultWithdraw.sharesMint],
        intent.vault.descriptor.sharesMint,
        'withdraw shares mint'
      )
      requireUserTokenAccount(context, accounts[layout.kvaultWithdraw.userTokenAccount], 'withdraw destination')
      requireUserShareAccount(context, accounts[layout.kvaultWithdraw.userShareAccount], 'withdraw share source')
      // Shares, not tokens. The API takes the same `amount` field for both
      // actions with inverted units, and an amount above the user's balance is
      // silently rewritten to u64::MAX — withdraw everything — so this is the
      // check that stands between a partial exit and a full one.
      requireAnchorAmount(data, position, intent.operation.withdraw.shares.baseUnits, 'withdraw share amount')
      return
    }

    case 'farmsInitializeUser': {
      requireMinimumAccounts(layout.farmsInitializeUser.minimumCount)
      requireOwner(context, accounts[layout.farmsInitializeUser.authority], 'farm user authority')
      requireFarm(context, accounts[layout.farmsInitializeUser.farm])
      return
    }

    case 'farmsStake': {
      // The stake that makes the deposit's shares invisible in the wallet. It
      // must move the user's own shares into this vault's own farm — a farm
      // belonging to another vault would park the position somewhere the app
      // never reads.
      requireMinimumAccounts(layout.farmsStake.minimumCount)
      requireOwner(context, accounts[layout.farmsStake.owner], 'stake authority')
      requireFarm(context, accounts[layout.farmsStake.farm])
      requireUserShareAccount(context, accounts[layout.farmsStake.userShareAccount], 'stake source')
      requireAccount(accounts[layout.farmsStake.sharesMint], intent.vault.descriptor.sharesMint, 'stake shares mint')

      // Kamino stakes the whole share balance rather than the freshly minted
      // amount, so the argument is the u64 sentinel. A different value is a
      // behaviour change, not a variation, and is worth stopping on.
      const argument = anchorU64Argument(data)
      if (argument === undefined) {
        return refuse('malformedInstruction', `instruction ${position}: farms stake argument`)
      }
      if (argument !== kaminoMaxBaseUnits) {
        refuse('amountMismatch', `staked share amount is ${argument}, expected ${kaminoMaxBaseUnits}`)
      }
      return
    }

    case 'farmsUnstake': {
      // The release of staked shares from the farm, and the one amount in
      // this feature that is not a u64: a u128 scaled by 10^18, checked in
      // exact bigint arithmetic with no division and no narrowing. Pinned to
      // the exact shortfall rather than bounded above by it: a LARGER unstake
      // would release shares the transaction then leaves sitting out of the
      // farm and no longer earning — a real loss, silent, and invisible on
      // the verify screen; a smaller one simply cannot settle.
      requireMinimumAccounts(layout.farmsUnstake.minimumCount)
      if (!('withdraw' in intent.operation)) {
        return refuse('instructionNotForOperation', 'farm unstake on a deposit')
      }
      requireOwner(context, accounts[layout.farmsUnstake.owner], 'unstake authority')
      requireFarm(context, accounts[layout.farmsUnstake.farm])
      requireFarmUserState(context, accounts[layout.farmsUnstake.userState])

      const scaled = anchorU128Argument(data)
      if (scaled === undefined) {
        return refuse('malformedInstruction', `instruction ${position}: farms unstake argument`)
      }
      const expected = kaminoUnstakeShares(intent.operation.withdraw).baseUnits * kaminoFarmsStakeScale
      if (scaled !== expected) {
        refuse('amountMismatch', `unstaked share amount is ${scaled}, expected ${expected}`)
      }
      return
    }

    case 'farmsWithdrawUnstakedDeposits': {
      // Moving what the unstake released into the user's own share account.
      // It takes no argument — it always moves the whole released balance —
      // so everything checkable here is an account, and the one that matters
      // is the destination: the vault withdraw burns from that same account,
      // and a destination belonging to anyone else would hand the position over.
      requireMinimumAccounts(layout.farmsWithdrawUnstakedDeposits.minimumCount)
      if (!('withdraw' in intent.operation)) {
        return refuse('instructionNotForOperation', 'farm unstaked share withdrawal on a deposit')
      }
      if (!hasNoAnchorArgument(data)) {
        return refuse(
          'malformedInstruction',
          `instruction ${position}: farms withdrawUnstakedDeposits takes no argument`
        )
      }
      requireOwner(context, accounts[layout.farmsWithdrawUnstakedDeposits.owner], 'unstaked share withdrawal authority')
      requireFarm(context, accounts[layout.farmsWithdrawUnstakedDeposits.farm])
      requireFarmUserState(context, accounts[layout.farmsWithdrawUnstakedDeposits.userState])
      requireUserShareAccount(
        context,
        accounts[layout.farmsWithdrawUnstakedDeposits.userShareAccount],
        'unstaked share destination'
      )
      return
    }

    case 'attributionMemo': {
      // The sequence already refuses any other payload under the Memo
      // program, so reaching here with different bytes is impossible — which
      // is exactly why it is asserted rather than assumed: the tag is the
      // only reason this program is allow-listed at all. No accounts, either:
      // a memo listing accounts is the Memo program attesting that they
      // signed, and attribution is not an attestation.
      requireNoAccounts(accounts, position, 'attribution memo')
      if (!isAttributionMemoData(data)) {
        refuse('malformedInstruction', `instruction ${position}: attribution memo`)
      }
      return
    }
  }
}

/**
 * Two rules, together covering "no unexplained writes". A writable account
 * nothing references is a loaded write privilege with no purpose, which is
 * not a shape any legitimate builder emits. And an account that a
 * builder-composed instruction can write to has to be one this operation can
 * name — the user, the vault, its two mints, or the user's own token accounts
 * for them. A drain has to write somewhere, and outside the `kvault`/`farms`
 * programs there is nowhere left for it to write.
 */
const validateWritableAccounts = (context: Context) => {
  const { transaction, accounts, programs } = context
  const instructions = transaction.message.compiledInstructions

  const referenced = new Set<number>()
  for (const instruction of instructions) {
    for (const index of instruction.accountKeyIndexes) referenced.add(index)
  }
  for (let index = 0; index < accounts.length; index++) {
    if (isKaminoAccountWritable({ transaction, index }) && !referenced.has(index)) {
      refuse('unreferencedWritableAccount', accounts[index])
    }
  }

  for (let position = 0; position < instructions.length; position++) {
    const program = programs[position]
    if (!program || !isBuilderComposedProgram(program)) continue
    for (const index of instructions[position].accountKeyIndexes) {
      if (!isKaminoAccountWritable({ transaction, index })) continue
      const account = accounts[index]
      if (!context.explainedAccounts.has(account)) {
        refuse('unattributableWritableAccount', `${program} writes ${account}`)
      }
    }
  }
}

/**
 * Fail-closed validation of a Kamino-built Solana transaction.
 *
 * Kamino builds the transaction and the app signs the bytes verbatim, so
 * between an API response and a signature over it there is only this. It runs
 * before simulation and before keysign, and every finding is a refusal.
 *
 * What it establishes, in layers: the shape (one unsigned signature, paid by
 * the user, every lookup table the vault's own); the programs (every
 * `programIdIndex` resolves to an allow-listed program — the outer bound on
 * what the signature can authorise); the sequence (the instruction list
 * matches the shape this operation produces, so a new instruction fails
 * closed); the identity of every account that decides where money goes,
 * compared against values the app already had — registry and local
 * derivations, never the response, because checking a transaction the API
 * built against metadata the same API supplied would be circular; the amounts
 * (the kvault `u64` equals what the user was shown, the priority fee equals
 * what the app injected); and the writable accounts (no unexplained writes).
 *
 * What it does not establish is what the `kvault` and `farms` programs do
 * with the accounts they are handed. That is the protocol, and choosing to
 * trust it is what the registry allow-list expresses.
 *
 * Pure — lookup tables arrive resolved, so tests can drive it against pinned
 * contents. `validateKaminoTransactionOnline` is the fetching entry point.
 */
export const validateKaminoTransaction = ({
  transaction,
  intent,
  lookupTables,
}: {
  transaction: VersionedTransaction
  intent: KaminoTransactionIntent
  /** Table address to that table's full address list. */
  lookupTables: Record<string, string[]>
}): void => {
  const vaultAddress = intent.vault.descriptor.address
  const registered = getKaminoVaultDescriptor(vaultAddress)
  if (!registered) return refuse('vaultNotAllowed', vaultAddress)
  // The registry's own object, not a value-equal copy. Every value the checks
  // below rest on — the mints, their decimals, the farm — lives on this
  // descriptor, so accepting one that merely *claims* an allow-listed address
  // would hand an attacker the pinning itself. Identity makes the registry
  // the only possible source of a vault's identity, structurally rather than
  // by convention.
  if (registered !== intent.vault.descriptor) {
    return refuse('vaultDescriptorMismatch', vaultAddress)
  }

  if (!isUnsignedSingleSigner(transaction, intent.owner)) {
    return refuse('transactionShape', 'not an unsigned single-signer transaction paid by the owner')
  }

  // Every table the transaction reads from must be the vault's own. A table
  // decides which pubkey an account index names, so a foreign one is how an
  // account substitution would be hidden. Zero tables is allowed — then every
  // account is a static key and there is nothing to hide behind.
  const lookups = transaction.message.addressTableLookups
  if (lookups.length > 1) return refuse('unexpectedLookupTable', `${lookups.length} lookup tables`)
  for (const lookup of lookups) {
    const address = lookup.accountKey.toBase58()
    if (address !== intent.vault.lookupTable) {
      return refuse('unexpectedLookupTable', `${address}, expected ${intent.vault.lookupTable}`)
    }
  }

  const accounts = resolveKaminoAccountAddresses({ transaction, lookupTables })
  if (!accounts || accounts.length !== totalKaminoAccountCount(transaction)) {
    return refuse('accountResolution', 'lookup tables do not resolve every account index')
  }

  const instructions = transaction.message.compiledInstructions
  const programs = instructions.map(instruction => kaminoAllowedProgram(accounts[instruction.programIdIndex]))
  for (let position = 0; position < programs.length; position++) {
    if (!programs[position]) {
      return refuse(
        'programNotAllowed',
        `instruction ${position} invokes ${accounts[instructions[position].programIdIndex]}`
      )
    }
  }

  // Before injection the app has chosen no fee and written no memo, so either
  // arriving in the response came from the builder — and each is named
  // separately so the refusal says what is actually wrong, rather than
  // reading as a sequencing error.
  if (!intent.priorityFee && programs.includes('computeBudget')) {
    return refuse('unexpectedPriorityFee', 'compute budget instruction before injection')
  }
  if (!intent.carriesAttributionMemo && programs.includes('memo')) {
    return refuse('unexpectedMemo', 'memo instruction before injection')
  }

  const userTokenAccounts = kaminoUserTokenAccounts({ owner: intent.owner, mint: intent.vault.descriptor.tokenMint })
  const userShareAccounts = kaminoUserTokenAccounts({ owner: intent.owner, mint: intent.vault.descriptor.sharesMint })
  if (userTokenAccounts.size === 0 || userShareAccounts.size === 0) {
    return refuse('derivationFailed', "the user's associated token accounts")
  }

  const context: Context = {
    intent,
    transaction,
    accounts,
    programs,
    userTokenAccounts,
    userShareAccounts,
    explainedAccounts: new Set([
      ...userTokenAccounts,
      ...userShareAccounts,
      intent.owner,
      intent.vault.descriptor.address,
      intent.vault.descriptor.tokenMint,
      intent.vault.descriptor.sharesMint,
    ]),
  }

  const kinds = instructions.map((instruction, position) => kaminoInstructionKind(programs[position], instruction.data))
  const steps = expectedKaminoSequence({
    operation: operationKind(intent),
    isWrappedSolVault: intent.vault.descriptor.tokenMint === kaminoConfig.wrappedSolMint,
    hasFarm: intent.vault.descriptor.farm !== undefined,
    hasPriorityFee: intent.priorityFee !== undefined,
    hasAttributionMemo: intent.carriesAttributionMemo,
    // This device read the position, so it knows which of the two withdraw
    // shapes it asked for and says so. Never 'unknown' here: accepting either
    // shape would let a transaction that unstakes shares pass as one that was
    // not supposed to touch the farm.
    farmUnstake:
      'withdraw' in intent.operation
        ? kaminoUnstakeShares(intent.operation.withdraw).baseUnits > 0n
          ? 'required'
          : 'forbidden'
        : 'forbidden',
  })

  const outcome = matchKaminoSequence(kinds, steps)
  if ('mismatch' in outcome) {
    const { mismatch } = outcome
    if ('unexpectedInstruction' in mismatch) {
      return refuse('unexpectedInstruction', `instruction ${mismatch.unexpectedInstruction.index}`)
    }
    return refuse(
      'missingInstruction',
      'missingInstruction' in mismatch ? mismatch.missingInstruction : mismatch.incompleteInstructionPair
    )
  }

  outcome.matched.forEach((kind, position) => validateInstruction(context, kind, position))
  validateWritableAccounts(context)
}

/**
 * Resolves the transaction's address lookup tables from the RPC, then runs
 * the pure validator against them.
 */
export const validateKaminoTransactionOnline = async ({
  transaction,
  intent,
}: {
  transaction: VersionedTransaction
  intent: KaminoTransactionIntent
}): Promise<void> => {
  const lookupTables = await resolveKaminoLookupTables(transaction)
  validateKaminoTransaction({ transaction, intent, lookupTables })
}
