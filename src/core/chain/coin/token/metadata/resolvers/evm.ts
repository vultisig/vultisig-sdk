import { EvmChain } from '../../../../Chain'
import { getEvmClient } from '../../../../chains/evm/client'
import { TokenMetadataResolver } from '../resolver'
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
    } as any),
    publicClient.readContract({
      address: id as Address,
      abi: erc20Abi,
      functionName: 'decimals',
    } as any),
  ])

  return {
    ticker,
    decimals,
  }
}
