import { Address, Cell, Slice } from '@ton/core'

import {
  DEDUST_FACTORIES,
  isKnownRouterAddress,
  STONFI_V2_PTON_WALLETS,
  STONFI_V2_ROUTERS,
} from './knownRouters'
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

const HEX_BOC_MAGIC_PREFIXES = ['b5ee9c72', '68ff65f3', 'acc3a728'] as const

const isHexBoc = (payload: string) => {
  if (payload.length % 2 !== 0) return false
  if (!/^[\da-f]+$/i.test(payload)) return false

  const lower = payload.toLowerCase()
  return HEX_BOC_MAGIC_PREFIXES.some(magic => lower.startsWith(magic))
}

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
  if (slice.remainingBits < 1) {
    throw new Error('Maybe-^Cell discriminator missing')
  }

  const hasRef = slice.loadBit()
  if (!hasRef) return null

  if (slice.remainingRefs < 1) {
    throw new Error('Maybe-^Cell discriminator set but no ref available')
  }

  return slice.loadRef()
}

const loadForwardPayload = (slice: Slice): Cell | null => {
  if (slice.remainingBits < 1) {
    throw new Error('Either-Cell discriminator missing')
  }

  const isRef = slice.loadBit()
  if (isRef) {
    if (slice.remainingRefs < 1) {
      throw new Error('Either-Cell discriminator set but no ref available')
    }
    return slice.loadRef()
  }

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

/**
 * Swap classification of the inner `forward_payload` of a STON.fi v2 jetton
 * transfer. Caller MUST already have verified that the jetton transfer's
 * inner destination is a known STON.fi v2 router; without that binding the
 * STON.fi swap opcode is forgeable and can be used to mislabel a transfer to
 * an attacker as a swap.
 */
const parseStonfiSwapPayload = (
  payload: Cell,
  offer: TonSwapOffer
): TonSwapIntent | null => parseStonfiV2Swap(payload, offer)

const parsePtonTransferSwap = (slice: Slice): TonSwapIntent | null =>
  safeDecode(() => {
    slice.loadUintBig(64)
    const offerAmount = slice.loadCoins()
    slice.loadAddress()

    const forwardPayload = loadForwardPayload(slice)
    if (!forwardPayload) return null

    return parseStonfiSwapPayload(forwardPayload, {
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

    const innerDestination = formatAddress(destination)

    // Swap classification is gated on the jetton transfer's inner destination
    // being a known STON.fi v2 router. DeDust jetton swaps are intentionally
    // not classified — DeDust uses one vault per jetton, and the vault set is
    // not statically enumerable. Callers needing DeDust jetton-swap detection
    // must verify the destination via DeDust factory `get_vault_address`.
    const swapIntent =
      forwardPayload && isKnownRouterAddress(innerDestination, STONFI_V2_ROUTERS)
        ? parseStonfiSwapPayload(forwardPayload, {
            offerAsset: 'jetton',
            offerAmount: amount,
          })
        : null

    if (swapIntent) return swapIntent

    return {
      kind: 'jettonTransfer',
      queryId,
      amount,
      destination: innerDestination,
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
    // forward_payload:(Either Cell ^Cell) — required by TEP-62; we don't
    // surface its content, but we must consume it to reject bodies truncated
    // before this field.
    loadForwardPayload(slice)
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
 * Input to {@link decodeTonMessageBody}. `outerDestination` is the `to` field
 * of the outgoing TON message (`TonMessage.to` in the keysign payload). It is
 * required to bind opcode-based swap classification to known router contracts.
 */
export type DecodeTonMessageBodyInput = {
  payload: string | null | undefined
  outerDestination: string | null | undefined
}

/**
 * Decode the body BOC of a TON internal message into a structured intent.
 *
 * Accepts the base64 BOC carried in `TonMessage.payload` (Vultisig's keysign
 * payload schema) along with the outer message destination. Returns `null`
 * when the payload is empty, not a parseable BOC, has no opcode header, or
 * carries an opcode this decoder doesn't yet handle — callers should fall
 * back to displaying the raw TON transfer.
 *
 * **Router binding.** Opcodes are contract-local in TON, so an attacker can
 * craft a body whose leading 32 bits collide with a known DEX swap opcode. To
 * prevent the keysign UI from labeling such a body as a "swap":
 *
 * - `DEDUST_NATIVE_SWAP` is dispatched only when `outerDestination` is a
 *   known DeDust factory.
 * - `PTON_TRANSFER` (STON.fi v2 TON-side swap) is dispatched only when
 *   `outerDestination` is a known STON.fi v2 pTON wallet.
 * - STON.fi v2 jetton-swap detection inside `JETTON_TRANSFER` is gated on
 *   the inner `destination` field being a known STON.fi v2 router.
 *
 * DeDust jetton-swap detection is intentionally not provided — DeDust vaults
 * are per-jetton and not statically enumerable.
 *
 * Note: dApps sometimes prefix a jetton transfer body with an empty 32-bit
 * "text comment" header (op = 0). In that case, we look at the next 32 bits.
 */
export const decodeTonMessageBody = ({
  payload: payloadBase64,
  outerDestination,
}: DecodeTonMessageBodyInput): TonMessageBodyIntent | null => {
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
    if (op === TonOp.PTON_TRANSFER) {
      if (!isKnownRouterAddress(outerDestination, STONFI_V2_PTON_WALLETS)) {
        return null
      }
      return parsePtonTransferSwap(slice)
    }
    if (op === TonOp.DEDUST_NATIVE_SWAP) {
      if (!isKnownRouterAddress(outerDestination, DEDUST_FACTORIES)) {
        return null
      }
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
