import { attempt } from '@vultisig/lib-utils/attempt'

import { CowSwapOrder } from '../sign/buildCowSwapOrder'

/**
 * Everything a consumer needs to (1) reconstruct the EIP-712 order digest to
 * sign and (2) submit the signed order to the orderbook — carried inside the
 * keysign payload so the off-chain CowSwap leg survives the round-trip through
 * the MPC ceremony without a bespoke proto message.
 *
 * CowSwap orders are settled off-chain by solvers, so the keysign payload has
 * no on-chain calldata to encode. Instead we serialize this into the
 * `OneInchTransaction.data` field (provider `'cowswap'`) and the consumer
 * decodes it after signing to call `submitCowSwapOrder`.
 */
export type CowSwapKeysignData = {
  order: CowSwapOrder
  chainId: number
  apiBase: string
  /** The order owner / signer address (the vault's EVM address). */
  from: string
  /** True when the sell token supports EIP-2612 permit (gasless approval). */
  permitRequired?: boolean
}

/** Marker prefix so a consumer can cheaply distinguish CowSwap order data from
 * the hex calldata that other general-swap providers put in the same field. */
export const cowSwapKeysignDataPrefix = 'cowswap-order:'

/** Serialize CowSwap order data for transport in the keysign payload's
 * `OneInchTransaction.data` field. */
export const encodeCowSwapKeysignData = (data: CowSwapKeysignData): string =>
  `${cowSwapKeysignDataPrefix}${JSON.stringify(data)}`

/** Recover CowSwap order data from a keysign payload's `data` field. Returns
 * `null` for non-CowSwap (hex calldata) or malformed payloads so callers can
 * branch without throwing. */
export const decodeCowSwapKeysignData = (data: string): CowSwapKeysignData | null => {
  if (!data.startsWith(cowSwapKeysignDataPrefix)) {
    return null
  }

  const json = data.slice(cowSwapKeysignDataPrefix.length)
  const result = attempt(() => JSON.parse(json) as CowSwapKeysignData)
  if (!('data' in result) || result.data == null || typeof result.data !== 'object') {
    return null
  }

  // Validate the decoded shape before handing it past the decode boundary — a
  // malformed payload (missing/wrong-typed fields) must not slip through and
  // fail later at sign/submit time.
  const parsed = result.data
  const isValid =
    typeof parsed.chainId === 'number' &&
    typeof parsed.apiBase === 'string' &&
    typeof parsed.from === 'string' &&
    parsed.order != null &&
    typeof parsed.order === 'object'

  return isValid ? parsed : null
}

/** Cheap discriminator for the consumer's keysign branch. */
export const isCowSwapKeysignData = (data: string): boolean => data.startsWith(cowSwapKeysignDataPrefix)
