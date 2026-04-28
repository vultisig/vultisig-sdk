import { Address, Cell, Slice } from '@ton/core'

import { TonOp } from './opcodes'
import { TonMessageBodyIntent, TonSwapIntent } from './types'

/**
 * `Address.toString()` defaults to URL-safe + bounceable, which matches the
 * mainnet user-friendly form (`EQ.../UQ...`) the wallet UI shows everywhere
 * else. Centralized so all decoded addresses share the same encoding.
 */
const formatAddress = (address: Address): string => address.toString()

const safeDecode = <T>(fn: () => T): T | null => {
  try {
    return fn()
  } catch {
    return null
  }
}

const isHexBoc = (payload: string) =>
  payload.length % 2 === 0 &&
  payload.toLowerCase().startsWith('b5ee9c') &&
  /^[\da-f]+$/i.test(payload)

export const tonPayloadToBase64 = (payload?: string | null): string | null => {
  if (!payload) return null

  const value = payload.trim()
  if (!isHexBoc(value)) return value

  return Buffer.from(value, 'hex').toString('base64')
}

const loadAddress = (slice: Slice): string => formatAddress(slice.loadAddress())

const loadMaybeAddress = (slice: Slice): string | null => {
  const address = slice.loadMaybeAddress()
  return address ? formatAddress(address) : null
}

const loadMaybeRef = (slice: Slice): Cell | null => {
  if (slice.remainingBits < 1) return null

  const hasRef = slice.loadBit()
  if (!hasRef || slice.remainingRefs < 1) return null

  return slice.loadRef()
}

const loadForwardPayload = (slice: Slice): Cell | null => {
  if (slice.remainingBits < 1) return null

  const isRef = slice.loadBit()
  if (isRef) return slice.remainingRefs > 0 ? slice.loadRef() : null

  return slice.asCell()
}

type TonSwapOffer = {
  offerAsset: TonSwapIntent['offerAsset']
  offerAmount: bigint
}

const parseStonfiV2Swap = (
  payload: Cell,
  offer: TonSwapOffer
): TonSwapIntent | null =>
  safeDecode(() => {
    const slice = payload.beginParse()

    if (slice.remainingBits < 32) return null

    const op = slice.loadUint(32)
    if (op !== TonOp.STONFI_V2_SWAP) return null

    const targetAddress = loadAddress(slice)
    const refundAddress = loadAddress(slice)
    const excessesAddress = loadAddress(slice)

    slice.loadUintBig(64)

    const additionalData = slice.loadRef().beginParse()
    const minOut = additionalData.loadCoins()
    const receiverAddress = loadAddress(additionalData)

    return {
      kind: 'swap',
      provider: 'stonfi',
      ...offer,
      minOut,
      receiverAddress,
      refundAddress,
      excessesAddress,
      targetAddress,
    }
  })

const parseDedustSwapStep = (slice: Slice) => {
  const targetAddress = loadAddress(slice)
  slice.loadBit()
  const minOut = slice.loadCoins()
  loadMaybeRef(slice)

  return { targetAddress, minOut }
}

const parseDedustSwapParams = (slice: Slice) => {
  slice.loadUint(32)
  const receiverAddress = loadMaybeAddress(slice)
  loadMaybeAddress(slice)
  loadMaybeRef(slice)
  loadMaybeRef(slice)

  return receiverAddress
}

const parseDedustSwap = (
  payload: Cell,
  offer: TonSwapOffer
): TonSwapIntent | null =>
  safeDecode(() => {
    const slice = payload.beginParse()

    if (slice.remainingBits < 32) return null

    const op = slice.loadUint(32)
    const isNativeSwap = op === TonOp.DEDUST_NATIVE_SWAP
    const isJettonSwap = op === TonOp.DEDUST_JETTON_SWAP
    if (!isNativeSwap && !isJettonSwap) return null

    const normalizedOffer = isNativeSwap
      ? (() => {
          slice.loadUintBig(64)
          return {
            offerAsset: 'ton',
            offerAmount: slice.loadCoins(),
          } satisfies TonSwapOffer
        })()
      : offer

    const { targetAddress, minOut } = parseDedustSwapStep(slice)
    const receiverAddress = parseDedustSwapParams(slice)

    return {
      kind: 'swap',
      provider: 'dedust',
      ...normalizedOffer,
      minOut,
      receiverAddress,
      refundAddress: null,
      excessesAddress: null,
      targetAddress,
    }
  })

const parseSwapPayload = (
  payload: Cell,
  offer: TonSwapOffer
): TonSwapIntent | null =>
  parseStonfiV2Swap(payload, offer) ?? parseDedustSwap(payload, offer)

const parsePtonTransferSwap = (slice: Slice): TonSwapIntent | null =>
  safeDecode(() => {
    slice.loadUintBig(64)
    const offerAmount = slice.loadCoins()
    slice.loadAddress()

    const forwardPayload = loadForwardPayload(slice)
    if (!forwardPayload) return null

    return parseSwapPayload(forwardPayload, {
      offerAsset: 'ton',
      offerAmount,
    })
  })

const parseJettonTransfer = (slice: Slice): TonMessageBodyIntent | null => {
  return safeDecode(() => {
    const queryId = slice.loadUintBig(64)
    const amount = slice.loadCoins()
    const destination = slice.loadAddress()
    const responseDestination = slice.loadMaybeAddress()
    // custom_payload is `Maybe ^Cell` — load and discard; we don't surface it.
    loadMaybeRef(slice)
    const forwardTonAmount = slice.loadCoins()
    const forwardPayload = loadForwardPayload(slice)
    const swapIntent = forwardPayload
      ? parseSwapPayload(forwardPayload, {
          offerAsset: 'jetton',
          offerAmount: amount,
        })
      : null

    if (swapIntent) return swapIntent

    return {
      kind: 'jettonTransfer',
      queryId,
      amount,
      destination: formatAddress(destination),
      responseDestination: responseDestination
        ? formatAddress(responseDestination)
        : null,
      forwardTonAmount,
    }
  })
}

const parseNftTransfer = (slice: Slice): TonMessageBodyIntent | null => {
  return safeDecode(() => {
    const queryId = slice.loadUintBig(64)
    const newOwner = slice.loadAddress()
    const responseDestination = slice.loadMaybeAddress()
    loadMaybeRef(slice)
    const forwardAmount = slice.loadCoins()
    return {
      kind: 'nftTransfer',
      queryId,
      newOwner: formatAddress(newOwner),
      responseDestination: responseDestination
        ? formatAddress(responseDestination)
        : null,
      forwardAmount,
    }
  })
}

const parseExcesses = (slice: Slice): TonMessageBodyIntent | null => {
  return safeDecode(() => ({
    kind: 'excesses',
    queryId: slice.loadUintBig(64),
  }))
}

/**
 * Decode the body BOC of a TON internal message into a structured intent.
 *
 * Accepts the base64 BOC carried in `TonMessage.payload` (Vultisig's keysign
 * payload schema). Returns `null` when the value is empty, not a parseable
 * BOC, has no opcode header, or carries an opcode this decoder doesn't yet
 * handle — callers should fall back to displaying the raw TON transfer.
 *
 * Note: dApps sometimes prefix a jetton transfer body with an empty 32-bit
 * "text comment" header (op = 0). In that case, we look at the next 32 bits.
 */
export const decodeTonMessageBody = (
  payloadBase64: string | null | undefined
): TonMessageBodyIntent | null => {
  const payload = tonPayloadToBase64(payloadBase64)
  if (!payload) return null

  const cell = safeDecode(() => Cell.fromBase64(payload))
  if (!cell) return null

  const slice = safeDecode(() => cell.beginParse())
  if (!slice) return null

  const dispatch = (op: number): TonMessageBodyIntent | null => {
    if (op === TonOp.JETTON_TRANSFER) return parseJettonTransfer(slice)
    if (op === TonOp.NFT_TRANSFER) return parseNftTransfer(slice)
    if (op === TonOp.EXCESSES) return parseExcesses(slice)
    if (op === TonOp.PTON_TRANSFER) return parsePtonTransferSwap(slice)
    if (op === TonOp.DEDUST_NATIVE_SWAP) {
      return parseDedustSwap(cell, { offerAsset: 'ton', offerAmount: 0n })
    }
    return null
  }

  if (slice.remainingBits < 32) return null

  const op = safeDecode(() => slice.loadUint(32))
  if (op === null) return null

  if (op === 0) {
    if (slice.remainingBits < 32) return null
    const nestedOp = safeDecode(() => slice.loadUint(32))
    if (nestedOp === null) return null
    return dispatch(nestedOp)
  }

  return dispatch(op)
}
