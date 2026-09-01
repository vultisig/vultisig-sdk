import { Buffer } from 'buffer'
import { validateTonComment } from '@vultisig/core-chain/chains/ton/comment'
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
}: BuildNativeTonTransferInput): TW.TheOpenNetwork.Proto.Transfer => {
  const comment = keysignPayload.memo || ''
  validateTonComment({ memo: comment })

  return TW.TheOpenNetwork.Proto.Transfer.create({
    dest: keysignPayload.toAddress,
    amount: tonAmountToBytes(keysignPayload.toAmount),
    bounceable,
    comment,
    mode: tonSendMode,
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
}: BuildNativeTonTransferFromMessageInput): TW.TheOpenNetwork.Proto.Transfer => {
  return TW.TheOpenNetwork.Proto.Transfer.create({
    dest: to,
    amount: tonAmountToBytes(amount),
    bounceable,
    comment: '',
    customPayload: payload || undefined,
    stateInit: stateInit || undefined,
    mode: tonSendMode,
  })
}
