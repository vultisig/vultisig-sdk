import { Chain } from '@core/chain/Chain'
import { findCoins } from '@core/chain/coin/find'
import { knownTokensIndex } from '@core/chain/coin/knownTokens'
import { getTokenMetadata as coreGetTokenMetadata } from '@core/chain/coin/token/metadata'

import type { DiscoveredToken, TokenInfo } from '../../types/tokens'
import { VaultError, VaultErrorCode } from '../VaultError'

export class TokenDiscoveryService {
  constructor(private getAddress: (chain: Chain) => Promise<string>) {}

  async discoverTokens(chain: Chain): Promise<DiscoveredToken[]> {
    try {
      const address = await this.getAddress(chain)
      const coins = await findCoins({ address, chain })
      return coins.map(coin => ({
        chain: coin.chain,
        contractAddress: coin.id ?? '',
        ticker: coin.ticker,
        decimals: coin.decimals,
        logo: coin.logo,
        balance: coin.balance?.toString(),
      }))
    } catch (error) {
      throw new VaultError(
        VaultErrorCode.BalanceFetchFailed,
        `Token discovery failed for ${chain}: ${error instanceof Error ? error.message : String(error)}`,
        error as Error
      )
    }
  }

  async resolveToken(chain: Chain, contractAddress: string): Promise<TokenInfo> {
    // Check known tokens first (fast, no network)
    const known = knownTokensIndex[chain]?.[contractAddress.toLowerCase()]
    if (known) {
      return {
        chain,
        contractAddress: known.id,
        ticker: known.ticker,
        decimals: known.decimals,
        logo: known.logo,
        priceProviderId: known.priceProviderId,
      }
    }

    // Fall back to chain-specific resolver
    try {
      const meta = await coreGetTokenMetadata({ chain, id: contractAddress })
      return {
        chain,
        contractAddress,
        ticker: meta.ticker,
        decimals: meta.decimals,
        logo: meta.logo,
        priceProviderId: meta.priceProviderId,
      }
    } catch (error) {
      throw new VaultError(
        VaultErrorCode.UnsupportedChain,
        `Cannot resolve token ${contractAddress} on ${chain}: ${error instanceof Error ? error.message : String(error)}`,
        error as Error
      )
    }
  }
}
