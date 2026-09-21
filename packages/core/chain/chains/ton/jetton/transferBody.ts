import { Address, beginCell, Cell, Slice } from '@ton/core'

import { TonOp } from '../messageBody/opcodes'

/** The 32-bit zero opcode that opens a TON text comment. */
const textCommentOpcode = 0

type BuildTonJettonTransferBodyInput = {
  /** Jetton amount in the jetton's minimal units. */
  amount: bigint
  /** The owner who ends up with the jettons (not their jetton wallet). */
  destination: string
  /** Where the jetton wallet refunds the unspent TON. */
  responseDestination: string
  /** TON forwarded with the recipient's `transfer_notification`. */
  forwardTonAmount: bigint
  /** Optional UTF-8 comment carried inline as the forward payload. */
  comment?: string
  queryId?: bigint
}

/**
 * A TEP-74 `transfer` body. The comment rides inline in `forward_payload`
 * (Either tag 0), the only form WalletCore emits, so a body built here decodes
 * the same way as one WalletCore signed. Throws if the comment does not fit
 * the cell; callers validate the length up front with `validateTonComment`.
 */
export const buildTonJettonTransferBody = ({
  amount,
  destination,
  responseDestination,
  forwardTonAmount,
  comment,
  queryId = 0n,
}: BuildTonJettonTransferBodyInput): Cell => {
  const body = beginCell()
    .storeUint(TonOp.JETTON_TRANSFER, 32)
    .storeUint(queryId, 64)
    .storeCoins(amount)
    .storeAddress(Address.parse(destination))
    .storeAddress(Address.parse(responseDestination))
    .storeBit(false) // custom_payload: none
    .storeCoins(forwardTonAmount)
    .storeBit(false) // forward_payload inline

  if (comment) {
    body.storeUint(textCommentOpcode, 32).storeStringTail(comment)
  }

  return body.endCell()
}

export type TonJettonTransferBody = {
  queryId: bigint
  amount: bigint
  destination: Address
  responseDestination: Address | null
  forwardTonAmount: bigint
  /** The text comment in `forward_payload`, or `null` when there is none or it is not a comment. */
  comment: string | null
  /** Whether `forward_payload` carries anything at all, comment or otherwise. */
  hasForwardPayload: boolean
  /** Whether a `custom_payload` cell rides along, which only special jetton wallets act on. */
  hasCustomPayload: boolean
}

const loadForwardPayloadSlice = (slice: Slice): Slice | null => {
  const isRef = slice.loadBit()
  if (isRef) {
    return slice.loadRef().beginParse()
  }

  return slice.remainingBits > 0 || slice.remainingRefs > 0 ? slice : null
}

const loadComment = (payload: Slice): string | null => {
  if (payload.remainingBits < 32 || payload.loadUint(32) !== textCommentOpcode) {
    return null
  }

  return payload.loadStringTail()
}

/**
 * Reads a TEP-74 `transfer` body back into its fields, or returns `null` when
 * the cell is not one. Used to check what a third party asks the wallet to
 * sign against what the user approved.
 */
export const parseTonJettonTransferBody = (cell: Cell): TonJettonTransferBody | null => {
  try {
    const slice = cell.beginParse()
    if (slice.remainingBits < 32 || slice.loadUint(32) !== TonOp.JETTON_TRANSFER) {
      return null
    }

    const queryId = slice.loadUintBig(64)
    const amount = slice.loadCoins()
    const destination = slice.loadAddress()
    const responseDestination = slice.loadMaybeAddress()
    const customPayload = slice.loadMaybeRef()
    const forwardTonAmount = slice.loadCoins()
    const forwardPayload = loadForwardPayloadSlice(slice)

    return {
      queryId,
      amount,
      destination,
      responseDestination,
      forwardTonAmount,
      comment: forwardPayload ? loadComment(forwardPayload) : null,
      hasForwardPayload: forwardPayload !== null,
      hasCustomPayload: customPayload !== null,
    }
  } catch {
    return null
  }
}
