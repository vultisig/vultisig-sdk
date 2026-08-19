import { PublicKey, VersionedTransaction } from '@solana/web3.js'

import { kaminoMaxBaseUnits, renderKaminoBaseUnits } from '../baseUnits'
import { kaminoConfig } from '../config'
import { KaminoVaultDescriptor, kaminoVaultRegistry } from '../registry'
import { clampKaminoUnitPrice, kaminoComputeBudget, kaminoExpectedUnitLimit } from './computeBudget'
import {
  anchorU64Argument,
  anchorU128Argument,
  computeUnitLimitArgument,
  computeUnitPriceArgument,
  deriveKaminoFarmsUserState,
  hasNoAnchorArgument,
  KaminoAllowedProgram,
  kaminoAllowedProgram,
  kaminoFarmsStakeScale,
  kaminoInstructionAccounts,
  systemTransferLamports,
} from './instructions'
import { expectedKaminoSequence, KaminoInstructionKind, kaminoInstructionKind, matchKaminoSequence } from './sequence'
import { KaminoPriorityFee, kaminoUserTokenAccounts } from './validate'
import { isUnsignedSingleSigner, parseKaminoWireTransaction } from './wire'

/**
 * What a Kamino transaction does, read back out of the bytes that will be
 * signed.
 *
 * Every field is derived from the wire message plus values the app already
 * holds — the vault registry and the associated-token-account derivation.
 * Nothing here is taken from a payload field, a summary, or the API, because
 * the point of this type is to be an INDEPENDENT reading: the initiator and a
 * co-signing device run the same decode over the same bytes and must arrive
 * at the same claim. A claim that agreed only because both devices were told
 * the same thing would establish nothing.
 */
export type KaminoDecodedTransaction = {
  operation: 'deposit' | 'withdraw'
  /** The curated vault, resolved from the registry — never a raw address the bytes named. */
  descriptor: KaminoVaultDescriptor
  /**
   * The `u64` the kvault instruction carries, in the operation's own unit:
   * underlying-token base units for a deposit, SHARE base units for a
   * withdraw.
   */
  amountBaseUnits: bigint
  /** The sole signer and fee payer — the account that authorises this. */
  signer: string
  /**
   * A deposit into the wrapped-SOL vault opens a wSOL account this
   * transaction never closes, so its rent stays locked up until the user
   * withdraws.
   */
  strandsWrappedSolRent: boolean
  /**
   * The ComputeBudget pair the bytes actually carry, or `undefined` when they
   * carry none. Read from the message rather than taken from the payload, so
   * the two can be COMPARED: the payload says what the initiating device
   * injected, the bytes say what will be charged.
   */
  priorityFee?: KaminoPriorityFee
}

/**
 * Whether a withdraw carries the `u64::MAX` sentinel, which the kVaults
 * program reads as *withdraw everything* rather than as a share count. This
 * app never produces one — the builder refuses to request it and the
 * validator pins the instruction's `u64` — but neither of those runs on a
 * co-signing device, which holds only the relayed bytes. Rendering 18.4
 * quintillion shares would be literally true and would say nothing about
 * what the transaction does.
 */
export const withdrawsEntireKaminoPosition = (decoded: KaminoDecodedTransaction): boolean =>
  decoded.operation === 'withdraw' && decoded.amountBaseUnits === kaminoMaxBaseUnits

/** The scale `amountBaseUnits` is expressed at, from the registry. */
export const kaminoDecodedAmountDecimals = (decoded: KaminoDecodedTransaction): number =>
  decoded.operation === 'deposit' ? decoded.descriptor.tokenDecimals : decoded.descriptor.sharesDecimals

/** The amount as plain human units — no grouping, no exponent, no locale. */
export const kaminoDecodedAmountString = (decoded: KaminoDecodedTransaction): string =>
  renderKaminoBaseUnits({ baseUnits: decoded.amountBaseUnits, decimals: kaminoDecodedAmountDecimals(decoded) })

/**
 * Whether these bytes invoke the kVaults program at all. Separate from
 * `decodeKaminoTransaction` on purpose: a transaction that invokes `kvault`
 * but cannot be decoded must be surfaced as unreadable rather than as an
 * ordinary Solana transaction. Program ids are always static keys, so this
 * needs no lookup table.
 */
export const invokesKaminoVaultProgram = (transaction: VersionedTransaction): boolean => {
  const accounts = transaction.message.staticAccountKeys.map(key => key.toBase58())
  return transaction.message.compiledInstructions.some(
    instruction => accounts[instruction.programIdIndex] === kaminoConfig.programId
  )
}

/**
 * Whether bytes this app cannot parse nonetheless mention the kVaults
 * program.
 *
 * The structured check above needs a v0 message, but a raw signing path signs
 * wire bytes verbatim without caring what version they are — so a LEGACY
 * transaction invoking kVaults would parse to nothing and, without this, be
 * classified as an ordinary Solana payload and sail past the signing guards.
 * A program id is a 32-byte account key in the message under either format,
 * so scanning for those bytes answers the only question that matters here:
 * is this something we must refuse to stay quiet about?
 *
 * Deliberately coarse, and coarse in the safe direction: a payload that
 * happens to contain these 32 bytes without invoking the program would be
 * refused; a payload that invokes the program cannot escape.
 */
export const mentionsKaminoVaultProgram = (base64Transaction: string): boolean => {
  let bytes: Buffer
  try {
    bytes = Buffer.from(base64Transaction, 'base64')
  } catch {
    return false
  }
  const needle = new PublicKey(kaminoConfig.programId).toBytes()
  return bytes.indexOf(Buffer.from(needle)) !== -1
}

const staticAddress = (accounts: string[], index: number | undefined): string | undefined =>
  index === undefined ? undefined : accounts[index]

/**
 * The curated vault whose share account for `owner` is `account`. The share
 * mint is pinned per vault in the registry and the ATA is a program-derived
 * address, so this is a local computation over a three-element allow-list.
 */
const descriptorForShareAccount = (account: string, owner: string): KaminoVaultDescriptor | undefined =>
  kaminoVaultRegistry.find(descriptor => kaminoUserTokenAccounts({ owner, mint: descriptor.sharesMint }).has(account))

/**
 * Whether a farms instruction acts on THIS signer's position in THIS vault's
 * farm. The user state is a program address over the farm and the owner, so
 * recomputing it locally binds the instruction to one farm and one user at
 * once — offline, which the farm slot itself cannot be: the farm is a
 * lookup-table entry in every captured transaction. The user state is a
 * static key in every captured transaction, which is what makes this
 * checkable here at all; one that is not static, or not the derived address,
 * is a refusal. The farm slot is compared too whenever it happens to resolve
 * statically.
 */
const actsOnSignersFarmPosition = ({
  accounts,
  userStateIndex,
  farmIndex,
  signer,
  descriptor,
}: {
  accounts: string[]
  userStateIndex: number
  farmIndex: number
  signer: string
  descriptor: KaminoVaultDescriptor
}): boolean => {
  const farm = descriptor.farm
  if (!farm) return false
  const expected = deriveKaminoFarmsUserState({ farm, owner: signer })
  if (!expected) return false
  if (staticAddress(accounts, userStateIndex) !== expected) return false

  const namedFarm = staticAddress(accounts, farmIndex)
  return namedFarm === undefined || namedFarm === farm
}

/**
 * Decodes the single kvault deposit or withdraw these bytes perform, or
 * `undefined` when they do not perform exactly one that this app recognises.
 *
 * `undefined` is a refusal to describe, never a "probably fine". This runs
 * offline — the verify and join screens render before any network call is
 * guaranteed to have happened — so lookup tables cannot be resolved, and the
 * vault is identified the other way round: by deriving each curated vault's
 * share account for this signer and matching it against the instruction's
 * share slot, which is a static key in every observed transaction. That
 * derivation is local, which makes it a stronger identification than reading
 * an address out of the bytes would have been.
 *
 * What this establishes: every instruction fits the shape the named
 * operation produces, the amount is the `u64` the kvault instruction
 * carries, the authority is the transaction's own signer, and the share
 * account that instruction spends or credits is the one this signer owns for
 * the named vault's share mint. Every instruction argument that is a spend
 * and is readable without a lookup table is also checked. What it does not
 * establish is the account identities that live in the lookup table — the
 * initiating device closes that gap by resolving the tables and running the
 * full validator before the payload exists.
 *
 * One residue is specific to the farm-staked withdraw: how many shares a
 * withdraw legitimately releases from the farm is `requested −
 * alreadyUnstaked`, and the second term is a balance that is not in the
 * bytes. So offline the release is bounded by the withdraw itself and no
 * further — while the release provably acts on this signer's own position,
 * in this vault's own farm, into the signer's own share account, with the
 * stranding and misdirection shapes refused by the template and the
 * derivations.
 */
export const decodeKaminoTransaction = (transaction: VersionedTransaction): KaminoDecodedTransaction | undefined => {
  const accounts = transaction.message.staticAccountKeys.map(key => key.toBase58())
  const signer = accounts[0]
  if (!signer) return undefined

  // The shape this app is willing to SIGN, not merely one it can read: a
  // single required signature, still an empty placeholder, paid for by slot
  // 0. A relayed transaction never passed through the initiator's checks, and
  // the raw signing path splices a signature into slot 0 without inspecting
  // how many the message requires — so a payload carrying a second required
  // signer would otherwise be summarised as an ordinary deposit.
  if (!isUnsignedSingleSigner(transaction, signer)) return undefined

  const instructions = transaction.message.compiledInstructions
  const programs: (KaminoAllowedProgram | undefined)[] = instructions.map(instruction =>
    kaminoAllowedProgram(accounts[instruction.programIdIndex] ?? '')
  )
  const kinds = instructions.map((instruction, position) => kaminoInstructionKind(programs[position], instruction.data))

  // Exactly one kvault instruction. Two would mean two amounts and two
  // vaults, and picking either to display would be a guess.
  const vaultPositions = kinds.flatMap((kind, position) =>
    kind === 'kvaultDeposit' || kind === 'kvaultWithdraw' ? [position] : []
  )
  if (vaultPositions.length !== 1) return undefined
  const position = vaultPositions[0]
  const operation = kinds[position] === 'kvaultDeposit' ? 'deposit' : 'withdraw'

  const instruction = instructions[position]
  const amount = anchorU64Argument(instruction.data)
  if (amount === undefined) return undefined

  const layout =
    operation === 'deposit' ? kaminoInstructionAccounts.kvaultDeposit : kaminoInstructionAccounts.kvaultWithdraw
  const indexes = instruction.accountKeyIndexes
  if (indexes.length < layout.minimumCount) return undefined

  // The authority slot must be this transaction's own signer. Without it the
  // amount and the vault would describe an instruction that some other
  // account authorises, which is not what the user is being asked to approve.
  if (staticAddress(accounts, indexes[layout.user]) !== signer) return undefined

  const shareAccount = staticAddress(accounts, indexes[layout.userShareAccount])
  if (!shareAccount) return undefined
  const descriptor = descriptorForShareAccount(shareAccount, signer)
  if (!descriptor) return undefined

  // When the vault slot happens to be a static key, it must be the vault the
  // share account identified. It is a lookup-table entry in every captured
  // transaction, but an attacker who moved it into the static keys must not
  // thereby escape the comparison.
  const namedVault = staticAddress(accounts, indexes[layout.vault])
  if (namedVault !== undefined && namedVault !== descriptor.address) return undefined

  // EVERY instruction must fit the shape this operation produces — not just
  // the one that was recognised. This is the check that stops a transfer
  // riding alongside a plausible deposit: the decode either accounts for the
  // whole transaction or it describes none of it. The fee/memo expectations
  // are read from the bytes rather than assumed, because this device did not
  // build the transaction; the memo's CONTENT is not read leniently — the
  // kind matcher takes the tag whole, so any other memo is already
  // unrecognisable here and the template refuses it.
  const steps = expectedKaminoSequence({
    operation,
    isWrappedSolVault: descriptor.tokenMint === kaminoConfig.wrappedSolMint,
    hasFarm: descriptor.farm !== undefined,
    hasPriorityFee: kinds.includes('computeUnitLimit') || kinds.includes('computeUnitPrice'),
    hasAttributionMemo: kinds.includes('attributionMemo'),
    // Which of the two withdraw shapes this is depends on how the signer's
    // position was split when the request was built, and this device holds no
    // position at all. So both shapes are accepted and the unstake is bounded
    // by its ARGUMENT instead — see below.
    farmUnstake: 'unknown',
  })
  const outcome = matchKaminoSequence(kinds, steps)
  if ('mismatch' in outcome) return undefined

  const priorityFee = readArguments({
    matched: outcome.matched,
    transaction,
    accounts,
    signer,
    operation,
    amount,
    descriptor,
    shareAccount,
  })
  if (!priorityFee) return undefined

  return {
    operation,
    descriptor,
    amountBaseUnits: amount,
    signer,
    strandsWrappedSolRent: operation === 'deposit' && descriptor.tokenMint === kaminoConfig.wrappedSolMint,
    priorityFee: priorityFee.fee,
  }
}

/**
 * Convenience over a raw payload: exactly one transaction, parseable as a v0
 * message. More than one is refused rather than summarised from the first —
 * describing one of several would put a claim on screen that is true of only
 * part of what gets signed.
 */
export const decodeKaminoRawTransactions = (rawTransactions: string[]): KaminoDecodedTransaction | undefined => {
  if (rawTransactions.length !== 1) return undefined
  const transaction = parseKaminoWireTransaction(rawTransactions[0])
  return transaction ? decodeKaminoTransaction(transaction) : undefined
}

/**
 * Checks every instruction contract that can be judged offline, and reads
 * out the priority fee the presentation cross-checks. Three kinds of check,
 * all of which the online validator also makes — the point is that a
 * co-signing device should refuse what the initiating device would have
 * refused, minus only what genuinely needs the network: amounts that are
 * spends, arguments that encode behaviour (`farms::stake` must carry
 * `u64::MAX`), and account cardinality.
 */
const readArguments = (input: {
  matched: KaminoInstructionKind[]
  transaction: VersionedTransaction
  accounts: string[]
  signer: string
  operation: 'deposit' | 'withdraw'
  amount: bigint
  descriptor: KaminoVaultDescriptor
  shareAccount: string
}): { fee?: KaminoPriorityFee } | undefined => {
  const { matched, transaction, ...shared } = input
  const fee: FeeAccumulator = {}

  for (let position = 0; position < matched.length; position++) {
    const { data, accountKeyIndexes } = transaction.message.compiledInstructions[position]
    const accepted = argumentChecks[matched[position]]({ ...shared, data, indexes: accountKeyIndexes }, fee)
    if (!accepted) return undefined
  }

  // Both halves or neither. The template already enforces that, but the pair
  // is what the fee is, so it is assembled rather than assumed.
  const { unitLimit, unitPriceMicroLamports } = fee
  if (unitLimit !== undefined && unitPriceMicroLamports !== undefined) {
    return { fee: { unitLimit, unitPriceMicroLamports } }
  }
  if (unitLimit === undefined && unitPriceMicroLamports === undefined) return {}
  return undefined
}

/** What every offline argument check receives for one matched instruction. */
type ArgumentCheck = {
  data: Uint8Array
  indexes: readonly number[]
  /** The message's static account keys, in index order. */
  accounts: string[]
  signer: string
  operation: 'deposit' | 'withdraw'
  /** The `u64` the kvault instruction carries — the bound on a farm release. */
  amount: bigint
  descriptor: KaminoVaultDescriptor
  shareAccount: string
}

/** The ComputeBudget pair, accumulated as the walk reads it. */
type FeeAccumulator = { unitLimit?: number; unitPriceMicroLamports?: bigint }

const accountLayout = kaminoInstructionAccounts

/**
 * Bounded on BOTH sides, because the producer clamps into exactly this range:
 * above the ceiling is SOL spent for nothing, below the floor is a
 * transaction that will not land before its blockhash expires — and either
 * way a price this app never chooses.
 */
const readComputeUnitPrice = ({ data, indexes }: ArgumentCheck, fee: FeeAccumulator): boolean => {
  const value = computeUnitPriceArgument(data)
  if (
    indexes.length > 0 ||
    value === undefined ||
    value < kaminoComputeBudget.fallbackUnitPriceMicroLamports ||
    value > kaminoComputeBudget.maxUnitPriceMicroLamports ||
    value !== clampKaminoUnitPrice(value)
  ) {
    return false
  }
  fee.unitPriceMicroLamports = value
  return true
}

const readComputeUnitLimit = (
  { data, indexes, operation, descriptor }: ArgumentCheck,
  fee: FeeAccumulator
): boolean => {
  const value = computeUnitLimitArgument(data)
  if (indexes.length > 0 || value === undefined || value !== kaminoExpectedUnitLimit({ operation, descriptor })) {
    return false
  }
  fee.unitLimit = value
  return true
}

const checkWrapSolTransfer = ({
  data,
  indexes,
  accounts,
  signer,
  operation,
  amount,
  descriptor,
}: ArgumentCheck): boolean => {
  const lamports = systemTransferLamports(data)
  if (
    operation !== 'deposit' ||
    lamports === undefined ||
    lamports !== amount ||
    indexes.length < accountLayout.systemTransfer.count ||
    staticAddress(accounts, indexes[accountLayout.systemTransfer.source]) !== signer
  ) {
    return false
  }
  // The destination is the user's own wrapped-SOL account whenever it
  // resolves statically — and it does in every captured transaction.
  const destination = staticAddress(accounts, indexes[accountLayout.systemTransfer.destination])
  return (
    destination === undefined || kaminoUserTokenAccounts({ owner: signer, mint: descriptor.tokenMint }).has(destination)
  )
}

/**
 * Bound to the signer's own wrapped-SOL account whenever the slot resolves
 * statically — the derivation needs no network, so leaving this looser than
 * the initiating validator would be an unnecessary asymmetry between the two
 * devices' refusals.
 */
const checkSyncNative = ({ indexes, accounts, signer, descriptor }: ArgumentCheck): boolean => {
  if (indexes.length === 0) return false
  const syncedAccount = staticAddress(accounts, indexes[0])
  return (
    syncedAccount === undefined ||
    kaminoUserTokenAccounts({ owner: signer, mint: descriptor.tokenMint }).has(syncedAccount)
  )
}

const checkFarmsStake = ({ data, indexes }: ArgumentCheck): boolean =>
  indexes.length >= accountLayout.farmsStake.minimumCount && anchorU64Argument(data) === kaminoMaxBaseUnits

const checkFarmsInitializeUser = ({ indexes }: ArgumentCheck): boolean =>
  indexes.length >= accountLayout.farmsInitializeUser.minimumCount

/**
 * The u128 WAD-scaled release amount. The exact figure is `requested −
 * unstaked`, and the unstaked half is a balance this device cannot read — so
 * what is checked here is the BOUND: a withdraw cannot legitimately take more
 * out of the farm than it burns. The authority is checked too, and that is
 * the half that matters most: whatever amount is released, it is released
 * from THIS signer's own farm position and nobody else's.
 */
const checkFarmsUnstake = ({
  data,
  indexes,
  accounts,
  signer,
  operation,
  amount,
  descriptor,
}: ArgumentCheck): boolean => {
  const scaled = anchorU128Argument(data)
  if (
    operation !== 'withdraw' ||
    indexes.length < accountLayout.farmsUnstake.minimumCount ||
    staticAddress(accounts, indexes[accountLayout.farmsUnstake.owner]) !== signer ||
    scaled === undefined ||
    scaled <= 0n ||
    scaled % kaminoFarmsStakeScale !== 0n ||
    scaled > amount * kaminoFarmsStakeScale
  ) {
    return false
  }
  return actsOnSignersFarmPosition({
    accounts,
    userStateIndex: indexes[accountLayout.farmsUnstake.userState],
    farmIndex: indexes[accountLayout.farmsUnstake.farm],
    signer,
    descriptor,
  })
}

/**
 * Where the released shares LAND. It has to be the same share account the
 * vault withdraw then burns from — the one already proven to be this signer's,
 * for this vault's share mint — or the release and the withdraw are two
 * unrelated movements presented as one.
 */
const checkFarmsWithdrawUnstakedDeposits = ({
  data,
  indexes,
  accounts,
  signer,
  operation,
  descriptor,
  shareAccount,
}: ArgumentCheck): boolean => {
  const layout = accountLayout.farmsWithdrawUnstakedDeposits
  if (
    operation !== 'withdraw' ||
    indexes.length < layout.minimumCount ||
    !hasNoAnchorArgument(data) ||
    staticAddress(accounts, indexes[layout.owner]) !== signer ||
    staticAddress(accounts, indexes[layout.userShareAccount]) !== shareAccount
  ) {
    return false
  }
  return actsOnSignersFarmPosition({
    accounts,
    userStateIndex: indexes[layout.userState],
    farmIndex: indexes[layout.farm],
    signer,
    descriptor,
  })
}

/**
 * Creating an account is not free — the PAYER funds its rent — and the step
 * is repeatable, so an extra creation for a stranger's wallet would otherwise
 * ride along unremarked and spend the signer's SOL. Both slots that decide
 * who pays and who owns are static keys. The mint and the derived address
 * need the lookup table; the initiating validator pins those.
 */
const checkCreateTokenAccount = ({ indexes, accounts, signer }: ArgumentCheck): boolean =>
  indexes.length >= accountLayout.associatedToken.count &&
  staticAddress(accounts, indexes[accountLayout.associatedToken.payer]) === signer &&
  staticAddress(accounts, indexes[accountLayout.associatedToken.wallet]) === signer

/**
 * Closing an account SENDS its rent somewhere. Where it lands, and who
 * authorised the close, decide whether that is the signer reclaiming their
 * own lamports or a third party collecting them.
 */
const checkCloseTokenAccount = ({ indexes, accounts, signer }: ArgumentCheck): boolean =>
  indexes.length >= accountLayout.closeAccount.count &&
  staticAddress(accounts, indexes[accountLayout.closeAccount.destination]) === signer &&
  staticAddress(accounts, indexes[accountLayout.closeAccount.authority]) === signer

/**
 * The tag itself was matched whole by the sequence. What is left to check is
 * that it attests to nobody: a memo carrying account indexes is the Memo
 * program asserting those accounts signed.
 */
const checkAttributionMemo = ({ indexes }: ArgumentCheck): boolean => indexes.length === 0

/**
 * Every instruction contract that can be judged offline, one entry per
 * template step. Three kinds of check, all of which the online validator also
 * makes — the point is that a co-signing device should refuse what the
 * initiating device would have refused, minus only what genuinely needs the
 * network: amounts that are spends, arguments that encode behaviour
 * (`farms::stake` must carry `u64::MAX`), and account cardinality.
 *
 * A record rather than a switch so each check stands alone and the set stays
 * exhaustive: a template step added without a check is a type error.
 */
const argumentChecks: Record<KaminoInstructionKind, (check: ArgumentCheck, fee: FeeAccumulator) => boolean> = {
  computeUnitPrice: readComputeUnitPrice,
  computeUnitLimit: readComputeUnitLimit,
  wrapSolTransfer: checkWrapSolTransfer,
  syncNative: checkSyncNative,
  farmsStake: checkFarmsStake,
  farmsInitializeUser: checkFarmsInitializeUser,
  farmsUnstake: checkFarmsUnstake,
  farmsWithdrawUnstakedDeposits: checkFarmsWithdrawUnstakedDeposits,
  createTokenAccount: checkCreateTokenAccount,
  closeTokenAccount: checkCloseTokenAccount,
  attributionMemo: checkAttributionMemo,
  // Already read by the caller: the amount, the authority and the share account.
  kvaultDeposit: () => true,
  kvaultWithdraw: () => true,
}
