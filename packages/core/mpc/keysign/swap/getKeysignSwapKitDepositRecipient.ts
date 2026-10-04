import { getSwapKitErc20DepositRecipient } from '@vultisig/core-chain/swap/general/knownAggregatorRouters'
import { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'

import { getKeysignChain } from '../utils/getKeysignChain'
import { getKeysignSwapPayload } from './getKeysignSwapPayload'

/**
 * The address a SwapKit ERC-20 deposit payload transfers the sold token to, decoded
 * from the calldata that gets signed, or undefined when the payload is not such a
 * deposit. Throws when it has the deposit shape but is not exactly
 * `transfer(recipient, fromAmount)` on the sold token (see `getSwapKitErc20DepositRecipient`).
 */
export const getKeysignSwapKitDepositRecipient = (keysignPayload: KeysignPayload): string | undefined => {
  const swapPayload = getKeysignSwapPayload(keysignPayload)
  if (!swapPayload || !('general' in swapPayload) || swapPayload.general.provider !== 'swapkit') return undefined

  const { quote, fromCoin, fromAmount } = swapPayload.general
  const tx = quote?.tx
  if (!tx) return undefined

  return getSwapKitErc20DepositRecipient({
    to: tx.to,
    data: tx.data,
    value: BigInt(tx.value),
    sourceToken: fromCoin?.contractAddress,
    amount: BigInt(fromAmount),
    chain: getKeysignChain(keysignPayload),
  })
}
