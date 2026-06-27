import { EvmChain } from '@vultisig/core-chain/Chain'
import { getEvmClient } from '@vultisig/core-chain/chains/evm/client'
import { AccountCoinKey, accountCoinKeyToString } from '@vultisig/core-chain/coin/AccountCoin'
import { isFeeCoin } from '@vultisig/core-chain/coin/utils/isFeeCoin'
import { Address, erc20Abi, parseAbi } from 'viem'

import { getEvmCoinBalance } from './resolvers/evm'

const multicall3Abi = parseAbi(['function getEthBalance(address addr) view returns (uint256)'])

export type GetEvmChainBalancesInput = {
  chain: EvmChain
  address: Address
  coins: AccountCoinKey<EvmChain>[]
}

export type EvmChainBalances = Record<string, bigint>

const getFallbackBalances = async ({ chain, address, coins }: GetEvmChainBalancesInput): Promise<EvmChainBalances> => {
  const entries = await Promise.all(
    coins.map(async coin => {
      const input = { ...coin, chain, address }

      try {
        return [accountCoinKeyToString(input), await getEvmCoinBalance(input)] as const
      } catch {
        return [accountCoinKeyToString(input), 0n] as const
      }
    })
  )

  return Object.fromEntries(entries)
}

export const getEvmChainBalances = async (input: GetEvmChainBalancesInput): Promise<EvmChainBalances> => {
  const { chain, address, coins } = input

  if (coins.length === 0) {
    return {}
  }

  const publicClient = getEvmClient(chain)
  const multicall3Address = publicClient.chain?.contracts?.multicall3?.address

  if (!multicall3Address) {
    return getFallbackBalances(input)
  }

  const contracts = coins.map(coin =>
    isFeeCoin(coin)
      ? {
          address: multicall3Address,
          abi: multicall3Abi,
          functionName: 'getEthBalance',
          args: [address],
        }
      : {
          address: coin.id as Address,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [address],
        }
  )

  const results = await publicClient
    .multicall({
      allowFailure: true,
      contracts,
    })
    .catch(() => undefined)

  if (!results) {
    return getFallbackBalances(input)
  }

  return Object.fromEntries(
    coins.map((coin, index) => {
      const result = results[index]
      const amount = result?.status === 'success' ? BigInt(result.result as bigint) : 0n

      return [accountCoinKeyToString({ ...coin, chain, address }), amount] as const
    })
  )
}
