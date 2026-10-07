import { isChainOfKind } from '@vultisig/core-chain/ChainKind'
import { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { parseNonNegativeBigInt } from '@vultisig/lib-utils/bigint/parseNonNegativeBigInt'

import { getKeysignChain } from '../utils/getKeysignChain'
import { getKeysignSwapPayload } from './getKeysignSwapPayload'

const MAX_UINT256 = (1n << 256n) - 1n

// Decimal only, like the iOS and Android co-signers: BigInt also reads '' and '0x0' as zero.
const parseSwapKitUint256 = (value: string, label: string): bigint => {
  const parsed = parseNonNegativeBigInt(value)
  if (parsed > MAX_UINT256) {
    throw new Error(`SwapKit ${label} ${value} does not fit in uint256 — refusing to sign.`)
  }

  return parsed
}

/**
 * Refuses a SwapKit payload whose `fromAmount` (every chain) or EVM `tx.value` is not a plain
 * decimal string within uint256, so every signer reads the amount the initiator quoted.
 */
export const assertKeysignSwapKitAmounts = (keysignPayload: KeysignPayload): void => {
  const swapPayload = getKeysignSwapPayload(keysignPayload)
  if (!swapPayload || !('general' in swapPayload) || swapPayload.general.provider !== 'swapkit') return

  const { fromAmount, quote } = swapPayload.general
  parseSwapKitUint256(fromAmount, 'fromAmount')

  // Only an EVM payload signs `tx.value`; a SwapKit Solana payload carries an empty one.
  const tx = quote?.tx
  if (tx && isChainOfKind(getKeysignChain(keysignPayload), 'evm')) {
    parseSwapKitUint256(tx.value, 'tx.value')
  }
}
