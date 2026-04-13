import { EvmChain } from '@vultisig/core-chain/Chain'
import { getEvmClient } from '@vultisig/core-chain/chains/evm/client'

type EvmCallParams = {
  to: `0x${string}`
  data: `0x${string}`
  from?: `0x${string}`
}

/**
 * Execute a read-only contract call (eth_call) on any EVM chain.
 *
 * @example
 * ```ts
 * const result = await evmCall('Ethereum', {
 *   to: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
 *   data: '0x18160ddd', // totalSupply()
 * })
 * ```
 */
export const evmCall = async (chain: EvmChain, params: EvmCallParams): Promise<`0x${string}`> => {
  const client = getEvmClient(chain)

  const result = await client.call({
    to: params.to,
    data: params.data,
    account: params.from,
  })

  if (!result.data) {
    throw new Error(`evm_call returned no data for ${params.to} on ${chain}`)
  }

  return result.data
}
