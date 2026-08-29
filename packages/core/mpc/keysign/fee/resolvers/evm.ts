import { getOpStackFeeSurcharge } from '@vultisig/core-chain/chains/evm/opStack/getOpStackFeeSurcharge'
import { isOpStackChain } from '@vultisig/core-chain/chains/evm/opStack/opStackChains'
import { formatDataToHex } from '@vultisig/lib-utils/formatDataToHex'
import { size } from 'viem'

import { KeysignPayload } from '../../../types/vultisig/keysign/v1/keysign_message_pb'
import { getBlockchainSpecificValue } from '../../chainSpecific/KeysignChainSpecific'
import { getKeysignSwapPayload } from '../../swap/getKeysignSwapPayload'
import { getKeysignChain } from '../../utils/getKeysignChain'
import { FeeAmountResolver } from '../resolver'

// Mirrors how the EVM chain-specific resolver picks the transaction's `data`, so
// the bytes the L1 fee is quoted for are the bytes that end up being signed.
const getCallDataSize = (keysignPayload: KeysignPayload): number => {
  const swapPayload = getKeysignSwapPayload(keysignPayload)
  const swapData = swapPayload && 'general' in swapPayload ? swapPayload.general.quote?.tx?.data : undefined
  const data = swapData || keysignPayload.memo

  return data ? size(formatDataToHex(data)) : 0
}

/**
 * What an EVM transaction costs its sender's balance: the gas the node holds
 * against it, plus the surcharges an OP-stack rollup adds to the same check.
 *
 * The gas term is `gasLimit * maxFeePerGas` — the worst case the node reserves
 * up front, not the eventual `gasUsed * effectiveGasPrice` — so anything derived
 * from this number stays affordable once the transaction lands.
 */
export const getEvmFeeAmount: FeeAmountResolver = async ({ keysignPayload }) => {
  const { maxFeePerGasWei, gasLimit } = getBlockchainSpecificValue(
    keysignPayload.blockchainSpecific,
    'ethereumSpecific'
  )

  const gasFee = BigInt(maxFeePerGasWei) * BigInt(gasLimit)

  const chain = getKeysignChain(keysignPayload)
  if (!isOpStackChain(chain)) {
    return gasFee
  }

  const surcharge = await getOpStackFeeSurcharge({
    chain,
    gasLimit: BigInt(gasLimit),
    callDataSize: getCallDataSize(keysignPayload),
  })

  return gasFee + surcharge
}
