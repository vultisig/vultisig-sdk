import { CoinKey, CoinMetadata, Token } from '@vultisig/core-chain/coin/Coin'
import { Resolver } from '@vultisig/lib-utils/types/Resolver'

import { ChainWithTokenMetadataDiscovery } from './chains'

export type TokenMetadataResolver<
  T extends ChainWithTokenMetadataDiscovery = ChainWithTokenMetadataDiscovery,
> = Resolver<Token<CoinKey<T>>, Promise<CoinMetadata>>
