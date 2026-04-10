import { EvmChain } from '@vultisig/core-chain/Chain'
import { getEvmClient } from '@vultisig/core-chain/chains/evm/client'

type EvmTxInfoParams = {
  address: `0x${string}`
  to?: `0x${string}`
  data?: `0x${string}`
  value?: bigint
}

type EvmTxInfoResult = {
  nonce: number
  baseFeePerGas: bigint
  maxPriorityFeePerGas: bigint
  suggestedMaxFeePerGas: bigint
  chainId: number
  estimatedGas?: bigint
}

/**
 * Get nonce, gas prices, and chain ID for building an EVM transaction.
 * Optionally estimates gas if `to`/`data`/`value` are provided.
 *
 * @example
 * ```ts
 * const info = await evmTxInfo('Ethereum', {
 *   address: '0xabc...',
 * })
 * // => { nonce: 42, baseFeePerGas: 30000000000n, ... }
 * ```
 */
export const evmTxInfo = async (chain: EvmChain, params: EvmTxInfoParams): Promise<EvmTxInfoResult> => {
  const client = getEvmClient(chain)

  const [nonce, block, maxPriorityFeePerGas, chainId] = await Promise.all([
    client.getTransactionCount({ address: params.address }),
    client.getBlock(),
    client.estimateMaxPriorityFeePerGas(),
    client.getChainId(),
  ])

  const baseFeePerGas = block.baseFeePerGas ?? 0n
  const suggestedMaxFeePerGas = baseFeePerGas * 2n + maxPriorityFeePerGas

  const result: EvmTxInfoResult = {
    nonce,
    baseFeePerGas,
    maxPriorityFeePerGas,
    suggestedMaxFeePerGas,
    chainId,
  }

  if (params.to) {
    result.estimatedGas = await client.estimateGas({
      account: params.address,
      to: params.to,
      data: params.data,
      value: params.value,
    })
  }

  return result
}
