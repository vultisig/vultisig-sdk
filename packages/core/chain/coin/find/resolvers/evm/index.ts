import { EvmChain } from '@vultisig/core-chain/Chain'
import { getEvmChainId } from '@vultisig/core-chain/chains/evm/chainInfo'
import { evmNativeCoinAddress } from '@vultisig/core-chain/chains/evm/config'
import { getErc20Balance } from '@vultisig/core-chain/chains/evm/erc20/getErc20Balance'
import { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import { FindCoinsResolver } from '@vultisig/core-chain/coin/find/resolver'
import { queryOneInch } from '@vultisig/core-chain/coin/find/resolvers/evm/queryOneInch'
import { vult } from '@vultisig/core-chain/coin/knownTokens'
import { OneInchToken } from '@vultisig/core-chain/coin/oneInch/token'
import { getEvmTokenMetadata } from '@vultisig/core-chain/coin/token/metadata/resolvers/evm'
import { without } from '@vultisig/lib-utils/array/without'
import { attempt } from '@vultisig/lib-utils/attempt'
import { NoDataError } from '@vultisig/lib-utils/error/NoDataError'
import { hexToNumber } from '@vultisig/lib-utils/hex/hexToNumber'
import { Address } from 'viem'

type GetDiscoveredEvmCoinInput = {
  address: string
  chain: EvmChain
  tokenAddress: string
  token?: OneInchToken
}

const getDiscoveredEvmCoin = async ({
  address,
  chain,
  tokenAddress,
  token,
}: GetDiscoveredEvmCoinInput): Promise<AccountCoin | undefined> => {
  if (token) {
    return {
      chain,
      id: token.address,
      decimals: token.decimals,
      logo: token.logoURI,
      ticker: token.symbol,
      address,
    }
  }

  const metadataResult = await attempt(() => getEvmTokenMetadata({ chain, id: tokenAddress }))

  if ('error' in metadataResult) {
    // Skip just this token rather than rejecting the whole Promise.all in
    // findEvmCoins. A NoDataError means the token genuinely has no metadata;
    // any other error is a transient on-chain/RPC hiccup. Either way, dropping
    // one token must NOT wipe out discovery of every other token on the chain
    // (USDC included) — that turns a single flaky metadata read into a
    // full "unable to retrieve your balances" failure. This path is hit for
    // every held token whenever the 1inch metadata call returns no data.
    if (!(metadataResult.error instanceof NoDataError)) {
      console.warn(
        `[findEvmCoins] metadata lookup failed for ${chain}:${tokenAddress}; skipping this token`,
        metadataResult.error
      )
    }
    return undefined
  }

  return {
    chain,
    id: tokenAddress,
    address,
    ...metadataResult.data,
  }
}

export const findEvmCoins: FindCoinsResolver<EvmChain> = async ({ address, chain }) => {
  const oneInchSupportedChains: EvmChain[] = [
    EvmChain.Ethereum,
    EvmChain.Base,
    EvmChain.Arbitrum,
    EvmChain.Polygon,
    EvmChain.Optimism,
    EvmChain.BSC,
    EvmChain.Avalanche,
    // 1inch (via the api.vultisig.com proxy) also serves zkSync Era (chainId
    // 324) — its /balance/v1.2/324/... and /token/v1.2/324/custom endpoints both
    // return 200. Zksync was missing here, so token discovery silently returned
    // [] on it (a false "you have no tokens"). Verified live 2026-07-03.
    EvmChain.Zksync,
  ]

  if (!oneInchSupportedChains.includes(chain)) {
    return []
  }

  const oneInchChainId = hexToNumber(getEvmChainId(chain))

  const balanceResult = await attempt(
    queryOneInch<Record<string, string>>(`/balance/v1.2/${oneInchChainId}/balances/${address}`)
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
    const tokenInfoResult = await attempt(
      queryOneInch<Record<string, OneInchToken>>(
        `/token/v1.2/${oneInchChainId}/custom?addresses=${nonZeroBalanceTokenAddresses.join(',')}`
      )
    )

    let tokenInfoData: Record<string, OneInchToken> = {}
    if ('data' in tokenInfoResult) {
      tokenInfoData = tokenInfoResult.data ?? {}
    } else if (!(tokenInfoResult.error instanceof NoDataError)) {
      throw tokenInfoResult.error
    }

    discoveredCoins = without(
      await Promise.all(
        nonZeroBalanceTokenAddresses.map(tokenAddress =>
          getDiscoveredEvmCoin({
            address,
            chain,
            tokenAddress,
            token: tokenInfoData[tokenAddress] ?? tokenInfoData[tokenAddress.toLowerCase()],
          })
        )
      ),
      undefined
    )
  }

  if (chain !== EvmChain.Ethereum || discoveredCoins.some(coin => coin.id?.toLowerCase() === vult.id.toLowerCase())) {
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
