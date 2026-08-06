import { Chain } from '@vultisig/core-chain/Chain'
import { findCoins } from '@vultisig/core-chain/coin/find'
import { knownTokensIndex } from '@vultisig/core-chain/coin/knownTokens'
import { getTokenMetadata as coreGetTokenMetadata } from '@vultisig/core-chain/coin/token/metadata'
import { ChainWithTokenMetadataDiscovery } from '@vultisig/core-chain/coin/token/metadata/chains'

import type { DiscoveredToken, TokenInfo } from '../../types/tokens'
import { VaultError, VaultErrorCode } from '../VaultError'

export class TokenDiscoveryService {
  constructor(private getAddress: (chain: Chain) => Promise<string>) {}

  async discoverTokens(chain: Chain): Promise<DiscoveredToken[]> {
    try {
      const address = await this.getAddress(chain)
      const coins = await findCoins({ address, chain })
      return coins.map(coin => {
        const tokenId = coin.id ?? ''
        const knownToken = knownTokensIndex[chain]?.[tokenId.toLowerCase()]

        return {
          chain: coin.chain,
          tokenId,
          contractAddress: tokenId,
          // Upstream indexes add order-dependent suffixes such as `USDC_1`
          // when two contracts share a symbol. Prefer the curated ecosystem
          // ticker for known contracts; callers already display the contract
          // address when they need to disambiguate same-symbol assets.
          ticker: knownToken?.ticker ?? coin.ticker.replace(/_\d+$/u, ''),
          decimals: coin.decimals,
          logo: coin.logo,
          ...(coin.isHidden === undefined ? {} : { isHidden: coin.isHidden }),
        }
      })
    } catch (error) {
      throw new VaultError(
        VaultErrorCode.BalanceFetchFailed,
        `Token discovery failed for ${chain}: ${error instanceof Error ? error.message : String(error)}`,
        error as Error
      )
    }
  }

  async resolveToken(chain: Chain, tokenId: string): Promise<TokenInfo> {
    // Check known tokens first (fast, no network)
    const known = knownTokensIndex[chain]?.[tokenId.toLowerCase()]
    if (known) {
      return {
        chain,
        tokenId: known.id,
        contractAddress: known.id,
        ticker: known.ticker,
        decimals: known.decimals,
        logo: known.logo,
        priceProviderId: known.priceProviderId,
      }
    }

    // Fall back to chain-specific resolver
    try {
      const meta = await coreGetTokenMetadata({ chain: chain as ChainWithTokenMetadataDiscovery, id: tokenId })
      return {
        chain,
        tokenId,
        contractAddress: tokenId,
        ticker: meta.ticker,
        decimals: meta.decimals,
        logo: meta.logo,
        priceProviderId: meta.priceProviderId,
      }
    } catch (error) {
      throw new VaultError(
        VaultErrorCode.UnsupportedChain,
        `Cannot resolve token ${tokenId} on ${chain}: ${error instanceof Error ? error.message : String(error)}`,
        error as Error
      )
    }
  }
}
