import { Buffer } from 'buffer'
import { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { numberToEvenHex } from '@vultisig/lib-utils/hex/numberToHex'
import { TW } from '@trustwallet/wallet-core'

type BuildNativeTonTransferFromMessageInput = {
  to: string
  amount: string
  payload?: string
  stateInit?: string
  bounceable: boolean
}

type BuildNativeTonTransferInput = {
  keysignPayload: KeysignPayload
  bounceable: boolean
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
 * Builds the single WalletCore transfer for an app-initiated native TON send.
 *
 * Always signs `keysignPayload.toAmount` under `PAY_FEES_SEPARATELY`, including for a
 * MAX send. The alternative — `ATTACH_ALL_CONTRACT_BALANCE` with `amount = 0` — hands
 * the wallet contract a sweep it resolves at execution time, so the transaction moves
 * whatever the balance happens to be when it lands rather than the number the user
 * approved. A MAX send is just `balance - fee` as an ordinary amount, and that fee is
 * the reserve the send mode then draws on.
 */
export const buildNativeTonTransfer = ({
  keysignPayload,
  bounceable,
}: BuildNativeTonTransferInput): TW.TheOpenNetwork.Proto.Transfer => {
  const mode =
    TW.TheOpenNetwork.Proto.SendMode.PAY_FEES_SEPARATELY | TW.TheOpenNetwork.Proto.SendMode.IGNORE_ACTION_PHASE_ERRORS

  return TW.TheOpenNetwork.Proto.Transfer.create({
    dest: keysignPayload.toAddress,
    amount: tonAmountToBytes(keysignPayload.toAmount),
    bounceable,
    comment: toSafeComment(keysignPayload.memo || ''),
    mode,
  })
}

export const buildNativeTonTransferFromMessage = ({
  to,
  amount,
  payload = '',
  stateInit,
  bounceable,
}: BuildNativeTonTransferFromMessageInput): TW.TheOpenNetwork.Proto.Transfer => {
  const mode =
    TW.TheOpenNetwork.Proto.SendMode.PAY_FEES_SEPARATELY | TW.TheOpenNetwork.Proto.SendMode.IGNORE_ACTION_PHASE_ERRORS

  return TW.TheOpenNetwork.Proto.Transfer.create({
    dest: to,
    amount: tonAmountToBytes(amount),
    bounceable,
    comment: '',
    customPayload: payload || undefined,
    stateInit: stateInit || undefined,
    mode,
  })
}
