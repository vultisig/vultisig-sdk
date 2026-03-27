import { EvmChain } from '@vultisig/core-chain/Chain'
import { getEvmChainId } from '@vultisig/core-chain/chains/evm/chainInfo'
import { getEvmClient } from '@vultisig/core-chain/chains/evm/client'
import { CoinMetadata } from '@vultisig/core-chain/coin/Coin'
import { queryOneInch } from '@vultisig/core-chain/coin/find/resolvers/evm/queryOneInch'
import { OneInchToken } from '@vultisig/core-chain/coin/oneInch/token'
import { TokenMetadataResolver } from '@vultisig/core-chain/coin/token/metadata/resolver'
import { attempt } from '@vultisig/lib-utils/attempt'
import { hexToNumber } from '@vultisig/lib-utils/hex/hexToNumber'
import { Address, erc20Abi } from 'viem'

export const getEvmTokenMetadata: TokenMetadataResolver<EvmChain> = async ({
  chain,
  id,
}) => {
  const publicClient = getEvmClient(chain)

  const [ticker, decimals] = await Promise.all([
    publicClient.readContract({
      address: id as Address,
      abi: erc20Abi,
      functionName: 'symbol',
    }),
    publicClient.readContract({
      address: id as Address,
      abi: erc20Abi,
      functionName: 'decimals',
    }),
  ])

  const result: CoinMetadata = {
    ticker,
    decimals,
  }

  const oneInchChainId = hexToNumber(getEvmChainId(chain))
  const normalizedId = id.toLowerCase()
  const logoResult = await attempt(() =>
    queryOneInch<Record<string, OneInchToken>>(
      `/token/v1.2/${oneInchChainId}/custom?addresses=${normalizedId}`
    )
  )

  if ('data' in logoResult && logoResult.data) {
    const tokenData = logoResult.data[normalizedId]
    if (tokenData?.logoURI) {
      result.logo = tokenData.logoURI
    }
  }

  return result
}
