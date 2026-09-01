import { Buffer } from 'buffer'
import { TonWalletVersion } from '@vultisig/core-chain/chains/ton/wallet'
import { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { numberToEvenHex } from '@vultisig/lib-utils/hex/numberToHex'
import { match } from '@vultisig/lib-utils/match'
import { TW } from '@trustwallet/wallet-core'

type BuildNativeTonTransferFromMessageInput = {
  to: string
  amount: string
  payload?: string
  stateInit?: string
  bounceable: boolean
  walletVersion: TonWalletVersion
}

type BuildNativeTonTransferInput = {
  keysignPayload: KeysignPayload
  bounceable: boolean
  walletVersion: TonWalletVersion
}

/** TON cell limit is 1023 bits; comment uses ~32 bits opcode + text. Max ~123 bytes. */
const tonCommentMaxBytes = 123

const tonCommentTooLongError = `TON memo exceeds ${tonCommentMaxBytes} bytes and would be truncated; reject oversized memos upstream`

export const toSafeComment = (payload: string): string => {
  const bytes = new TextEncoder().encode(payload)
  if (bytes.length > tonCommentMaxBytes) {
    throw new Error(tonCommentTooLongError)
  }
  return payload
}

export const validateTonComment = (memo: string): void => {
  const bytes = new TextEncoder().encode(memo)
  if (bytes.length > tonCommentMaxBytes) {
    throw new Error(`TON memo must be at most ${tonCommentMaxBytes} bytes (got ${bytes.length})`)
  }
}

const tonUnsignedDecimalRegex = /^\d+$/
const tonMaxAmount = (1n << 120n) - 1n
const tonMaxAmountDecimal = tonMaxAmount.toString()

export const tonAmountToBytes = (amount: string | bigint): Buffer => {
  if (typeof amount === 'string' && !tonUnsignedDecimalRegex.test(amount)) {
    throw new Error('TON amount must be a non-negative integer')
  }

  const normalizedAmount = typeof amount === 'string' ? amount.replace(/^0+(?=\d)/, '') : amount
  if (
    typeof normalizedAmount === 'string' &&
    (normalizedAmount.length > tonMaxAmountDecimal.length ||
      (normalizedAmount.length === tonMaxAmountDecimal.length && normalizedAmount > tonMaxAmountDecimal))
  ) {
    throw new Error('TON amount exceeds the VarUInteger 16 maximum')
  }

  const value = typeof normalizedAmount === 'bigint' ? normalizedAmount : BigInt(normalizedAmount)
  if (value < 0n) {
    throw new Error('TON amount must be a non-negative integer')
  }
  if (value > tonMaxAmount) {
    throw new Error('TON amount exceeds the VarUInteger 16 maximum')
  }

  return Buffer.from(numberToEvenHex(value), 'hex')
}

/**
 * Send mode for every app-initiated TON transfer.
 *
 * `PAY_FEES_SEPARATELY` (+1) charges forwarding fees to the wallet balance instead of
 * deducting them from the transferred value, so the recipient gets the amount we showed.
 *
 * `IGNORE_ACTION_PHASE_ERRORS` (+2) is deliberately absent. With it set, a wallet contract
 * that cannot carry out its outgoing transfer skips the action instead of failing: the
 * transaction lands un-aborted with the seqno consumed and nothing moved, which on chain is
 * indistinguishable from a successful send. Without it the transfer fails visibly and the
 * user's funds stay put.
 *
 * The mode is part of the signing preimage: every co-signing device derives the hash from
 * this payload, so changing it here breaks keysign with any client that has not changed too.
 */
export const tonSendMode = TW.TheOpenNetwork.Proto.SendMode.PAY_FEES_SEPARATELY

/**
 * The send mode for a given wallet contract.
 *
 * W5 is the exception to the rule above: its code refuses an external request
 * unless every action carries `IGNORE_ACTION_PHASE_ERRORS`, because that is
 * how it guarantees the seqno advances even when an action fails — the
 * contract's own replay protection. WalletCore enforces the same check before
 * it will build the message. The blindness the flag causes is covered on the
 * other side: the status resolver reads the action phase, so a W5 send whose
 * transfer was skipped reports as failed instead of confirmed.
 */
export const getTonSendMode = (walletVersion: TonWalletVersion): number =>
  match(walletVersion, {
    v4r2: () => tonSendMode,
    v5r1: () => tonSendMode | TW.TheOpenNetwork.Proto.SendMode.IGNORE_ACTION_PHASE_ERRORS,
  })

/**
 * Builds the single WalletCore transfer for an app-initiated native TON send.
 *
 * Always signs `keysignPayload.toAmount` under `tonSendMode`, including for a MAX send.
 * The alternative — `ATTACH_ALL_CONTRACT_BALANCE` with `amount = 0` — hands the wallet
 * contract a sweep it resolves at execution time, so the transaction moves whatever the
 * balance happens to be when it lands rather than the number the user approved. A MAX
 * send is just `balance - fee` as an ordinary amount, and that fee is the reserve the
 * send mode then draws on.
 */
export const buildNativeTonTransfer = ({
  keysignPayload,
  bounceable,
  walletVersion,
}: BuildNativeTonTransferInput): TW.TheOpenNetwork.Proto.Transfer => {
  return TW.TheOpenNetwork.Proto.Transfer.create({
    dest: keysignPayload.toAddress,
    amount: tonAmountToBytes(keysignPayload.toAmount),
    bounceable,
    comment: toSafeComment(keysignPayload.memo || ''),
    mode: getTonSendMode(walletVersion),
  })
}

/**
 * Builds a transfer for one message of a dApp-supplied `signTon` request. The
 * message carries its own payload/stateInit, so no comment is attached here.
 */
export const buildNativeTonTransferFromMessage = ({
  to,
  amount,
  payload = '',
  stateInit,
  bounceable,
  walletVersion,
}: BuildNativeTonTransferFromMessageInput): TW.TheOpenNetwork.Proto.Transfer => {
  return TW.TheOpenNetwork.Proto.Transfer.create({
    dest: to,
    amount: tonAmountToBytes(amount),
    bounceable,
    comment: '',
    customPayload: payload || undefined,
    stateInit: stateInit || undefined,
    mode: getTonSendMode(walletVersion),
  })
}
