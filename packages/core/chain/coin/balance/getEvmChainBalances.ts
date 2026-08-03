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

/**
 * Balances keyed by `accountCoinKeyToString`. A key is present ONLY when the balance was actually
 * READ: a present `0n` is a genuine zero balance, an ABSENT key means "unknown, the call failed".
 * Callers must not conflate the two — caching/emitting a fabricated zero for a coin the user owns
 * shows a real 0 for an owned asset until the cache expires.
 */
export type EvmChainBalances = Record<string, bigint>

const getFallbackBalances = async ({ chain, address, coins }: GetEvmChainBalancesInput): Promise<EvmChainBalances> => {
  const entries = await Promise.all(
    coins.map(async coin => {
      const input = { ...coin, chain, address }

      try {
        return [accountCoinKeyToString(input), await getEvmCoinBalance(input)] as const
      } catch {
        // OMIT the key rather than reporting 0n: the read failed, so the balance is unknown.
        return undefined
      }
    })
  )

  return Object.fromEntries(entries.filter(entry => entry !== undefined))
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
    coins.flatMap((coin, index) => {
      const result = results[index]

      // A reverted / failed sub-call (allowFailure keeps it in the array as status 'failure') carries
      // NO balance. Omit it instead of decoding it as 0n, so the caller can tell an unread coin from a
      // genuinely empty one and refetch it rather than caching a fabricated zero.
      if (result?.status !== 'success') {
        return []
      }

      return [[accountCoinKeyToString({ ...coin, chain, address }), BigInt(result.result as bigint)] as const]
    })
  )
}
