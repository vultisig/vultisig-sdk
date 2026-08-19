import { Chain } from '@vultisig/core-chain/Chain'
import { getChainKind } from '@vultisig/core-chain/ChainKind'
import { findCoins } from '@vultisig/core-chain/coin/find'
import { knownTokensIndex } from '@vultisig/core-chain/coin/knownTokens'
import { getTokenMetadata as coreGetTokenMetadata } from '@vultisig/core-chain/coin/token/metadata'
import { ChainWithTokenMetadataDiscovery } from '@vultisig/core-chain/coin/token/metadata/chains'

import type { Token } from '../../types'
import type { DiscoveredToken, TokenInfo } from '../../types/tokens'
import { normalizedTokenIdentity } from '../tokenRef'
import { VaultError, VaultErrorCode } from '../VaultError'

const syntheticTickerSuffix = /_\d+$/u

function tickerBase(ticker: string): string {
  return ticker.replace(/@[a-z0-9]{8,}$/iu, '').replace(syntheticTickerSuffix, '')
}

function tokenIdentity(chain: Chain, tokenId: string): string {
  return normalizedTokenIdentity(chain, tokenId)
}

function knownTokenLookupId(chain: Chain, tokenId: string): string {
  return getChainKind(chain) === 'evm' ? tokenId.toLowerCase() : tokenId
}

function compactTokenId(tokenId: string): string {
  return (tokenId.replace(/[^a-z0-9]/giu, '').toLowerCase() || 'unknown').padStart(8, '0')
}

function caseSensitiveHash(value: string): string {
  let hash = 0x811c9dc5
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function addressDiscriminator(tokenId: string, collidingIdentities: Set<string>): string {
  const compactId = compactTokenId(tokenId)
  const compactIdentities = [...collidingIdentities].map(compactTokenId)
  if (compactIdentities.filter(identity => identity === compactId).length > 1) {
    return `${compactId.slice(-8)}${caseSensitiveHash(tokenId)}`
  }
  for (let length = 8; length <= compactId.length; length += 1) {
    const suffix = compactId.slice(-length)
    if (compactIdentities.filter(identity => identity.endsWith(suffix)).length === 1) return suffix
  }
  return compactId
}

export class TokenDiscoveryService {
  constructor(
    private getAddress: (chain: Chain) => Promise<string>,
    private getTokens: (chain: Chain) => Token[] = () => []
  ) {}

  async discoverTokens(chain: Chain): Promise<DiscoveredToken[]> {
    try {
      const address = await this.getAddress(chain)
      const coins = await findCoins({ address, chain })
      const candidates = coins.map(coin => {
        const tokenId = coin.id ?? ''
        const knownToken = knownTokensIndex[chain]?.[knownTokenLookupId(chain, tokenId)]

        return { coin, tokenId, ticker: knownToken?.ticker ?? tickerBase(coin.ticker) }
      })
      const identitiesByTicker = new Map<string, Set<string>>()
      const recordTickerIdentity = (ticker: string | undefined, tokenId: string) => {
        if (!ticker) return
        const key = tickerBase(ticker).toUpperCase()
        const identities = identitiesByTicker.get(key) ?? new Set<string>()
        identities.add(tokenIdentity(chain, tokenId))
        identitiesByTicker.set(key, identities)
      }

      for (const token of this.getTokens(chain)) {
        recordTickerIdentity(token.symbol, token.contractAddress || token.id)
      }
      for (const candidate of candidates) {
        recordTickerIdentity(candidate.ticker, candidate.tokenId)
      }

      return candidates.map(({ coin, tokenId, ticker }) => {
        const collidingIdentities = identitiesByTicker.get(tickerBase(ticker).toUpperCase()) ?? new Set<string>()
        const hasSymbolCollision = collidingIdentities.size > 1

        return {
          chain: coin.chain,
          tokenId,
          contractAddress: tokenId,
          // Upstream suffixes such as `_1` depend on discovery order. Strip one
          // only when the base symbol identifies a single contract; otherwise
          // replace it with a stable address-derived discriminator.
          ticker: hasSymbolCollision ? `${ticker}@${addressDiscriminator(tokenId, collidingIdentities)}` : ticker,
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
    const known = knownTokensIndex[chain]?.[knownTokenLookupId(chain, tokenId)]
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
