import { create } from '@bufbuild/protobuf'
import { EvmChain } from '../../../../chain/Chain'
import { getEvmClient } from '../../../../chain/chains/evm/client'
import { deriveEvmGasLimit } from '../../../../chain/tx/fee/evm/evmGasLimit'
import { getEvmFeeQuote } from '../../fee/resolvers/evm/getEvmFeeQuote'
import { EthereumSpecificSchema } from '../../../types/vultisig/keysign/v1/blockchain_specific_pb'

import { getKeysignSwapPayload } from '../../swap/getKeysignSwapPayload'
import { getKeysignCoin } from '../../utils/getKeysignCoin'
import { GetChainSpecificResolver } from '../resolver'

export const getEvmChainSpecific: GetChainSpecificResolver<
  'ethereumSpecific'
> = async ({ keysignPayload, feeSettings, thirdPartyGasLimitEstimation }) => {
  const coin = getKeysignCoin<EvmChain>(keysignPayload)
  const { chain, address } = coin
  const client = getEvmClient(chain)

  const nonce = BigInt(
    await client.getTransactionCount({
      address: address as `0x${string}`,
    })
  )

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

  const { gasLimit, baseFeePerGas, maxPriorityFeePerGas } =
    await getEvmFeeQuote({
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
