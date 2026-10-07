import { isChainOfKind } from '@vultisig/core-chain/ChainKind'
import { getSwapKitErc20DepositRecipient } from '@vultisig/core-chain/swap/general/knownAggregatorRouters'
import { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'

import { getKeysignChain } from '../utils/getKeysignChain'
import { parseSwapKitUint256 } from './assertKeysignSwapKitAmounts'
import { getKeysignSwapPayload } from './getKeysignSwapPayload'

/**
 * The address a SwapKit ERC-20 deposit payload transfers the sold token to, decoded
 * from the calldata that gets signed, or undefined when the payload is not such a
 * deposit (always undefined off EVM). Throws when it has the deposit shape but is not exactly
 * `transfer(recipient, fromAmount)` on the sold token (see `getSwapKitErc20DepositRecipient`), or when
 * `tx.value` or `fromAmount` is not a plain decimal string within uint256.
 */
export const getKeysignSwapKitDepositRecipient = (keysignPayload: KeysignPayload): string | undefined => {
  const swapPayload = getKeysignSwapPayload(keysignPayload)
  if (!swapPayload || !('general' in swapPayload) || swapPayload.general.provider !== 'swapkit') return undefined

  const { quote, fromCoin, fromAmount } = swapPayload.general
  const tx = quote?.tx
  if (!tx) return undefined

  // An ERC-20 deposit only exists on EVM; a SwapKit Solana payload carries an empty `value`.
  const chain = getKeysignChain(keysignPayload)
  if (!isChainOfKind(chain, 'evm')) return undefined

  return getSwapKitErc20DepositRecipient({
    to: tx.to,
    data: tx.data,
    value: parseSwapKitUint256(tx.value, 'tx.value'),
    sourceToken: fromCoin?.contractAddress,
    amount: parseSwapKitUint256(fromAmount, 'fromAmount'),
    chain,
  })
}
