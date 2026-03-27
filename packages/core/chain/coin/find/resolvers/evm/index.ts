import { EvmChain } from '@vultisig/core-chain/Chain'
import { getEvmChainId } from '@vultisig/core-chain/chains/evm/chainInfo'
import { evmNativeCoinAddress } from '@vultisig/core-chain/chains/evm/config'
import { getErc20Balance } from '@vultisig/core-chain/chains/evm/erc20/getErc20Balance'
import { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import { FindCoinsResolver } from '@vultisig/core-chain/coin/find/resolver'
import { queryOneInch } from '@vultisig/core-chain/coin/find/resolvers/evm/queryOneInch'
import { vult } from '@vultisig/core-chain/coin/knownTokens'
import { OneInchToken } from '@vultisig/core-chain/coin/oneInch/token'
import { without } from '@vultisig/lib-utils/array/without'
import { attempt } from '@vultisig/lib-utils/attempt'
import { NoDataError } from '@vultisig/lib-utils/error/NoDataError'
import { hexToNumber } from '@vultisig/lib-utils/hex/hexToNumber'
import { Address } from 'viem'

export const findEvmCoins: FindCoinsResolver<EvmChain> = async ({
  address,
  chain,
}) => {
  const oneInchSupportedChains: EvmChain[] = [
    EvmChain.Ethereum,
    EvmChain.Base,
    EvmChain.Arbitrum,
    EvmChain.Polygon,
    EvmChain.Optimism,
    EvmChain.BSC,
    EvmChain.Avalanche,
  ]

  if (!oneInchSupportedChains.includes(chain)) {
    return []
  }

  const oneInchChainId = hexToNumber(getEvmChainId(chain))

  const balanceResult = await attempt(
    queryOneInch<Record<string, string>>(
      `/balance/v1.2/${oneInchChainId}/balances/${address}`
    )
  )

  let balanceData: Record<string, string> = {}
  if ('data' in balanceResult) {
    balanceData = balanceResult.data ?? {}
  } else if (!(balanceResult.error instanceof NoDataError)) {
    throw balanceResult.error
  }

  // Filter tokens with non-zero balance
  const nonZeroBalanceTokenAddresses = Object.entries(balanceData)
    .filter(([_, balance]) => BigInt(balance as string) > 0n) // Ensure the balance is non-zero
    .map(([tokenAddress]) => tokenAddress)
    .filter(tokenAddress => tokenAddress !== evmNativeCoinAddress)

  let discoveredCoins: AccountCoin[] = []
  if (nonZeroBalanceTokenAddresses.length > 0) {
    const tokenInfoData = await queryOneInch<Record<string, OneInchToken>>(
      `/token/v1.2/${oneInchChainId}/custom?addresses=${nonZeroBalanceTokenAddresses.join(',')}`
    )
    const tokens = without(
      nonZeroBalanceTokenAddresses.map(
        tokenAddress => tokenInfoData[tokenAddress]
      ),
      undefined
    )

    discoveredCoins = without(
      tokens.map(token => {
        if (token.logoURI && token.providers.includes('CoinGecko')) {
          return {
            chain,
            id: token.address,
            decimals: token.decimals,
            logo: token.logoURI,
            ticker: token.symbol,
            address,
          }
        }
      }),
      undefined
    )
  }

  if (
    chain !== EvmChain.Ethereum ||
    discoveredCoins.some(
      coin => coin.id?.toLowerCase() === vult.id.toLowerCase()
    )
  ) {
    return discoveredCoins
  }

  const vultBalanceResult = await attempt(() =>
    getErc20Balance({
      chain,
      address: vult.id as Address,
      accountAddress: address as Address,
    })
  )

  if ('data' in vultBalanceResult && vultBalanceResult.data !== undefined) {
    if (vultBalanceResult.data > 0n) {
      discoveredCoins.push({
        ...vult,
        address,
      })
    }
  }

  return discoveredCoins
}
