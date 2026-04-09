import { EvmChain } from '@vultisig/core-chain/Chain'
import { getEvmClient } from '@vultisig/core-chain/chains/evm/client'
import { erc20Abi } from 'viem'

type CheckAllowanceParams = {
  tokenAddress: `0x${string}`
  owner: `0x${string}`
  spender: `0x${string}`
}

type CheckAllowanceResult = {
  allowance: bigint
  decimals: number
  symbol: string
}

/**
 * Query ERC-20 approval amount for a spender on any EVM chain.
 *
 * @example
 * ```ts
 * const result = await evmCheckAllowance('Ethereum', {
 *   tokenAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
 *   owner: '0xabc...',
 *   spender: '0xdef...',
 * })
 * // => { allowance: 1000000n, decimals: 6, symbol: 'USDC' }
 * ```
 */
export const evmCheckAllowance = async (
  chain: EvmChain,
  params: CheckAllowanceParams
): Promise<CheckAllowanceResult> => {
  const client = getEvmClient(chain)
  const { tokenAddress, owner, spender } = params

  const [allowance, decimals, symbol] = await Promise.all([
    client.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [owner, spender],
    }),
    client.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'decimals',
    }),
    client.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'symbol',
    }),
  ])

  return { allowance, decimals, symbol }
}
