import {
  computeBudgetDiscriminators,
  createIdempotentAtaDiscriminator,
  hasAnchorDiscriminator,
  isAttributionMemoData,
  KaminoAllowedProgram,
  kaminoDiscriminators,
  systemTransferDiscriminator,
  tokenCloseAccountDiscriminator,
  tokenSyncNativeDiscriminator,
} from './instructions'

/**
 * The instruction shapes each Kamino operation produces, and the walk that
 * matches a transaction against them.
 *
 * Shared by the two places that need it, because they must agree on what a
 * Kamino transaction is *allowed to contain*: the validator runs it on the
 * initiating device before signing, followed by account-identity checks that
 * need the lookup tables resolved; the decoder runs it on ANY device, offline,
 * before claiming to describe a transaction. Without it the decode would read
 * one recognised instruction and say nothing about the rest — so a transfer
 * riding alongside a plausible deposit would be summarised as "Deposit
 * 1 USDC", which is worse than showing nothing at all.
 *
 * A step matches on the program and the instruction discriminator only. Both
 * are readable without a lookup table (a v0 message's program ids are always
 * static keys), which is what lets the offline decode use the same template
 * as the online validator. Everything else about an instruction is checked
 * after it has been matched, so a wrong ACCOUNT is a refusal rather than a
 * silent failure to match.
 */
export const kaminoInstructionKinds = [
  'computeUnitLimit',
  'computeUnitPrice',
  'createTokenAccount',
  'wrapSolTransfer',
  'syncNative',
  'closeTokenAccount',
  'kvaultDeposit',
  'kvaultWithdraw',
  'farmsInitializeUser',
  'farmsStake',
  'farmsUnstake',
  'farmsWithdrawUnstakedDeposits',
  'attributionMemo',
] as const

/** One recognised instruction shape. */
export type KaminoInstructionKind = (typeof kaminoInstructionKinds)[number]

/** Human-readable step names, used in refusal messages. */
export const kaminoInstructionKindName: Record<KaminoInstructionKind, string> = {
  computeUnitLimit: 'compute unit limit',
  computeUnitPrice: 'compute unit price',
  createTokenAccount: 'create associated token account',
  wrapSolTransfer: 'SOL wrap transfer',
  syncNative: 'wrapped SOL sync',
  closeTokenAccount: 'close token account',
  kvaultDeposit: 'vault deposit',
  kvaultWithdraw: 'vault withdraw',
  farmsInitializeUser: 'farm user initialization',
  farmsStake: 'farm stake',
  farmsUnstake: 'farm unstake',
  farmsWithdrawUnstakedDeposits: 'farm unstaked share withdrawal',
  attributionMemo: 'attribution memo',
}

/**
 * One template step. `pairedWith` names a step this one may only appear
 * alongside: either both are matched or neither is. Optionality is per-step,
 * and for two instructions that are halves of ONE operation that is not
 * enough — `farms::unstake` releases shares into a pending-withdrawal balance
 * and `farms::withdraw_unstaked_deposits` is what moves them out of it, so an
 * unstake on its own strands shares somewhere neither the position read nor
 * the verify screen describes.
 */
export type KaminoSequenceStep = {
  kind: KaminoInstructionKind
  isRequired: boolean
  isRepeatable: boolean
  pairedWith?: KaminoInstructionKind
}

/**
 * Whether a withdraw is supposed to release shares from the vault's farm.
 *
 * The API decides this from the user's position: a request that fits inside
 * the shares already sitting in their share account is built as a plain
 * withdraw, and anything above it is built with the farms pair in front. The
 * three cases are three different claims:
 *
 * - `required` — the initiating device, which read the position and sized the
 *   request against it. A transaction missing the unstake is refused.
 * - `forbidden` — the same device, for a request that fits the unstaked
 *   balance. A transaction CARRYING an unstake is refused.
 * - `unknown` — the offline decode on a co-signing device, which holds no
 *   position to compare against. Either shape is accepted, and what bounds it
 *   there is the argument check: the unstake amount may not exceed the shares
 *   the withdraw itself burns.
 */
export type KaminoFarmUnstakeExpectation = 'required' | 'forbidden' | 'unknown'

/** Why a transaction does not fit the template. */
export type KaminoSequenceMismatch =
  | { unexpectedInstruction: { index: number } }
  | { missingInstruction: string }
  | { incompleteInstructionPair: string }

type ExpectedSequenceInput = {
  operation: 'deposit' | 'withdraw'
  isWrappedSolVault: boolean
  hasFarm: boolean
  /**
   * Whether the app's ComputeBudget pair has been injected. The API emits
   * none, so before injection their presence is a refusal and after it their
   * absence is.
   */
  hasPriorityFee: boolean
  /**
   * Whether the app's attribution memo has been appended. Same contract as
   * the fee, for the same reason: the API emits no memo, so one arriving
   * before injection came from somewhere else, and one missing after
   * injection means the tag this app claims to write is not in the bytes it
   * is about to sign.
   */
  hasAttributionMemo: boolean
  /** Ignored for a deposit. */
  farmUnstake: KaminoFarmUnstakeExpectation
}

/**
 * The shape `operation` produces against a vault with these properties,
 * verified by decoding transactions the Kamino API built and simulating them
 * on mainnet.
 *
 * Optional steps are the ones whose absence cannot cost the user anything —
 * an idempotent account creation that was already done, a farm user that
 * already exists, a token account that stays open. Everything that decides
 * where money moves is required, and anything not listed at all is refused.
 */
export const expectedKaminoSequence = ({
  operation,
  isWrappedSolVault,
  hasFarm,
  hasPriorityFee,
  hasAttributionMemo,
  farmUnstake,
}: ExpectedSequenceInput): KaminoSequenceStep[] => {
  const steps: KaminoSequenceStep[] = []
  const step = (
    kind: KaminoInstructionKind,
    isRequired: boolean,
    isRepeatable: boolean,
    pairedWith?: KaminoInstructionKind
  ) => steps.push({ kind, isRequired, isRepeatable, pairedWith })

  if (hasPriorityFee) {
    step('computeUnitLimit', true, false)
    step('computeUnitPrice', true, false)
  }

  if (operation === 'deposit') {
    step('createTokenAccount', false, true)
    if (isWrappedSolVault) {
      step('wrapSolTransfer', true, false)
      step('syncNative', true, false)
      step('createTokenAccount', false, true)
    }
    step('kvaultDeposit', true, false)
    if (hasFarm) {
      // Only the user's farm state may already exist. The stake itself is
      // what makes the shares the position the app then reads, so a deposit
      // that omits it is not the deposit that was requested.
      step('farmsInitializeUser', false, false)
      step('farmsStake', true, false)
    }
  } else {
    // The share account the released shares land in, created first because
    // the two farms instructions below need it to exist.
    step('createTokenAccount', false, true)
    if (hasFarm && farmUnstake !== 'forbidden') {
      // BOTH farms instructions, and both BEFORE the vault withdraw — the
      // shares have to be out of the farm and in the user's own account
      // before anything can burn them. They appear together or not at all;
      // `farmUnstake` decides which of the two transaction shapes this is
      // supposed to be, so a caller that knows gets a REQUIRED pair and a
      // caller that cannot know gets an optional one — never a silent
      // "either is fine" for the device that could have checked.
      const required = farmUnstake === 'required'
      step('farmsUnstake', required, false, 'farmsWithdrawUnstakedDeposits')
      step('farmsWithdrawUnstakedDeposits', required, false, 'farmsUnstake')
      step('createTokenAccount', false, true)
    }
    step('kvaultWithdraw', true, false)
    // Emptied token accounts, closed so their rent comes back. REPEATABLE,
    // because a full wrapped-SOL withdraw carries two: the payout account and
    // the now-empty share account. REQUIRED on the wrapped-SOL vault, where
    // closing the payout account is what unwraps wSOL into the native SOL the
    // screen says the user receives; optional elsewhere.
    step('closeTokenAccount', isWrappedSolVault, true)
  }

  // Last, because that is where the injector appends it: the memo records who
  // originated the transaction and takes no part in what it does.
  if (hasAttributionMemo) {
    step('attributionMemo', true, false)
  }

  return steps
}

/**
 * The kind of instruction this program and payload are, or `undefined` when
 * it is none the template knows. Program and discriminator only — see the
 * module doc for why.
 */
export const kaminoInstructionKind = (
  program: KaminoAllowedProgram | undefined,
  data: Uint8Array
): KaminoInstructionKind | undefined => {
  if (!program) return undefined
  switch (program) {
    case 'computeBudget':
      if (data[0] === computeBudgetDiscriminators.setUnitLimit) return 'computeUnitLimit'
      if (data[0] === computeBudgetDiscriminators.setUnitPrice) return 'computeUnitPrice'
      return undefined
    case 'associatedToken':
      return data[0] === createIdempotentAtaDiscriminator ? 'createTokenAccount' : undefined
    case 'system':
      return data.length >= 4 && systemTransferDiscriminator.every((byte, index) => data[index] === byte)
        ? 'wrapSolTransfer'
        : undefined
    case 'token':
    case 'token2022':
      if (data.length === 1 && data[0] === tokenSyncNativeDiscriminator) return 'syncNative'
      if (data.length === 1 && data[0] === tokenCloseAccountDiscriminator) return 'closeTokenAccount'
      return undefined
    case 'kvault':
      if (hasAnchorDiscriminator(data, kaminoDiscriminators.kvaultDeposit)) return 'kvaultDeposit'
      // TWO discriminators, one kind: `withdraw` and `withdraw_from_available`
      // are the same withdraw — same `u64` share argument, same authority,
      // same share account burned, same payout account credited — and which
      // one the builder emits says only whether the vault's liquid buffer
      // covered the request. That is a fact about the vault's balance sheet,
      // not about what the user is being asked to approve. They may share the
      // account map because the IDL declares `withdraw`'s account list as
      // `withdraw_from_available`'s accounts followed by the reserve group.
      if (
        hasAnchorDiscriminator(data, kaminoDiscriminators.kvaultWithdraw) ||
        hasAnchorDiscriminator(data, kaminoDiscriminators.kvaultWithdrawFromAvailable)
      ) {
        return 'kvaultWithdraw'
      }
      return undefined
    case 'memo':
      // The tag is matched WHOLE, not as a prefix. A memo is free-form bytes,
      // so the tag followed by anything else is a different memo — and the
      // one thing this app is willing to sign under the Memo program is its
      // own attribution tag, exactly.
      return isAttributionMemoData(data) ? 'attributionMemo' : undefined
    case 'farms':
      if (hasAnchorDiscriminator(data, kaminoDiscriminators.farmsInitializeUser)) return 'farmsInitializeUser'
      if (hasAnchorDiscriminator(data, kaminoDiscriminators.farmsStake)) return 'farmsStake'
      if (hasAnchorDiscriminator(data, kaminoDiscriminators.farmsUnstake)) return 'farmsUnstake'
      if (hasAnchorDiscriminator(data, kaminoDiscriminators.farmsWithdrawUnstakedDeposits)) {
        return 'farmsWithdrawUnstakedDeposits'
      }
      return undefined
  }
}

/**
 * Walks `steps` and `kinds` together. A step that does not match is skipped
 * only when it is optional; an instruction left over at the end has no place
 * in this operation at all.
 *
 * `kinds` holds one entry per instruction, in order, `undefined` for an
 * instruction whose program is not allow-listed or whose discriminator is not
 * one the template names.
 */
export const matchKaminoSequence = (
  kinds: (KaminoInstructionKind | undefined)[],
  steps: KaminoSequenceStep[]
): { matched: KaminoInstructionKind[] } | { mismatch: KaminoSequenceMismatch } => {
  const matched: KaminoInstructionKind[] = []
  let cursor = 0

  const matches = (kind: KaminoInstructionKind, position: number): boolean =>
    position < kinds.length && kinds[position] === kind

  for (const step of steps) {
    if (step.isRepeatable) {
      // A repeatable step consumes as many as it finds — and if it is also
      // REQUIRED it has to find at least one. Skipping that check because the
      // loop already ran is how "one or more" silently becomes "zero or
      // more": the wrapped-SOL withdraw's close is both, and without this its
      // requirement would not exist.
      let consumed = 0
      while (matches(step.kind, cursor)) {
        matched.push(step.kind)
        cursor += 1
        consumed += 1
      }
      if (step.isRequired && consumed === 0) {
        return { mismatch: { missingInstruction: kaminoInstructionKindName[step.kind] } }
      }
      continue
    }
    if (matches(step.kind, cursor)) {
      matched.push(step.kind)
      cursor += 1
    } else if (step.isRequired) {
      return { mismatch: { missingInstruction: kaminoInstructionKindName[step.kind] } }
    }
  }

  if (cursor !== kinds.length) {
    return { mismatch: { unexpectedInstruction: { index: cursor } } }
  }

  // Paired steps, last: a half-operation is a refusal even when both of its
  // halves were individually optional — either the transaction releases
  // shares from the farm and moves them, or it does neither.
  for (const step of steps) {
    if (!step.pairedWith) continue
    if (matched.includes(step.kind) !== matched.includes(step.pairedWith)) {
      return { mismatch: { incompleteInstructionPair: kaminoInstructionKindName[step.kind] } }
    }
  }

  return { matched }
}
