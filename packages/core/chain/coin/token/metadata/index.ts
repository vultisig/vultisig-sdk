import { getChainKind } from '@vultisig/core-chain/ChainKind'

import { ChainKindWithTokenMetadataDiscovery } from './chains'
import { TokenMetadataResolver } from './resolver'
import { getCardanoTokenMetadata } from './resolvers/cardano'
import { getCosmosTokenMetadata } from './resolvers/cosmos'
import { getEvmTokenMetadata } from './resolvers/evm'
import { getSolanaTokenMetadata } from './resolvers/solana'
import { getSuiTokenMetadata } from './resolvers/sui'
import { getTonTokenMetadata } from './resolvers/ton'
import { getTronTokenMetadata } from './resolvers/tron'

const resolvers: Record<ChainKindWithTokenMetadataDiscovery, TokenMetadataResolver<any>> = {
  evm: getEvmTokenMetadata,
  solana: getSolanaTokenMetadata,
  cosmos: getCosmosTokenMetadata,
  ton: getTonTokenMetadata,
  tron: getTronTokenMetadata,
  cardano: getCardanoTokenMetadata,
  sui: getSuiTokenMetadata,
}

export const getTokenMetadata: TokenMetadataResolver = async input => {
  const chainKind = getChainKind(input.chain)

  const resolver = resolvers[chainKind]

  return resolver(input)
}
