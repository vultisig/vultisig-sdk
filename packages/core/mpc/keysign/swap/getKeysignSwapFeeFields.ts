import { GeneralSwapPayload } from './KeysignSwapPayload'

/**
 * The `swap_fee` group of a general swap payload: the provider fee plus the
 * coin context that makes it priceable. An empty `swapFee` means the payload
 * states no fee — either the route carries none, or the sender predates the
 * fields.
 */
export type KeysignSwapFeeFields = {
  swapFee: string
  swapFeeChain?: string
  swapFeeTokenId?: string
  swapFeeDecimals?: number
}

/**
 * Reads the fee group from whichever place a general swap payload keeps it: on
 * the quoted transaction for 1inch-shaped payloads, on the payload itself for
 * SwapKit's transfer routes, which quote no transaction to hang it on.
 *
 * Consumers must still validate the coin context before pricing the amount —
 * `swap_fee_chain` is an unvalidated protobuf string.
 */
export const getKeysignSwapFeeFields = (payload: GeneralSwapPayload): KeysignSwapFeeFields =>
  'txType' in payload ? payload : (payload.quote?.tx ?? { swapFee: '' })
