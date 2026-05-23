import { create } from '@bufbuild/protobuf'
import { EvmChain } from '@vultisig/core-chain/Chain'
import { getEvmClient } from '@vultisig/core-chain/chains/evm/client'
import { deriveEvmGasLimit } from '@vultisig/core-chain/tx/fee/evm/evmGasLimit'
import { getEvmFeeQuote } from '@vultisig/core-mpc/keysign/fee/resolvers/evm/getEvmFeeQuote'
import { EthereumSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'

import { getKeysignSwapPayload } from '../../swap/getKeysignSwapPayload'
import { getKeysignCoin } from '../../utils/getKeysignCoin'
import { GetChainSpecificResolver } from '../resolver'

export const getEvmChainSpecific: GetChainSpecificResolver<'ethereumSpecific'> = async ({
  keysignPayload,
  feeSettings,
  thirdPartyGasLimitEstimation,
}) => {
  const coin = getKeysignCoin<EvmChain>(keysignPayload)
  const { chain, address } = coin
  const client = getEvmClient(chain)

  // Use the `pending` block tag so mempool txs are counted. Without this,
  // back-to-back dApp transactions (e.g. CCTP v2 approve() followed
  // immediately by depositForBurn()) get the same nonce because the first
  // tx hasn't been mined yet. Fall back to `latest` for chains that don't
  // support the pending tag cleanly (zkSync Era, Hyperliquid, some alt-EVMs).
  const getNonce = async () => {
    const params = { address: address as `0x${string}` }
    try {
      return await client.getTransactionCount({ ...params, blockTag: 'pending' })
    } catch {
      return client.getTransactionCount({ ...params, blockTag: 'latest' })
    }
  }
  const nonce = BigInt(await getNonce())

  const getData = () => {
    const swapPayload = getKeysignSwapPayload(keysignPayload)
    if (swapPayload && 'general' in swapPayload) {
      const value = swapPayload.general.quote?.tx?.data
      if (value) {
        return value
      }
    }

    return keysignPayload.memo
  }

  const { gasLimit, baseFeePerGas, maxPriorityFeePerGas } = await getEvmFeeQuote({
    keysignPayload,
    feeSettings,
    thirdPartyGasLimitEstimation,
    minimumGasLimit: deriveEvmGasLimit({
      coin,
      data: getData(),
    }),
  })

  const maxFeePerGas = baseFeePerGas + maxPriorityFeePerGas

  return create(EthereumSpecificSchema, {
    nonce,
    maxFeePerGasWei: maxFeePerGas.toString(),
    priorityFee: maxPriorityFeePerGas.toString(),
    gasLimit: gasLimit.toString(),
  })
}
