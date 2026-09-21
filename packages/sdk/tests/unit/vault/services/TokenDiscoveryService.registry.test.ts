import { Chain } from '@vultisig/core-chain/Chain'
import { findCoins } from '@vultisig/core-chain/coin/find'
import { knownTokens, usdc } from '@vultisig/core-chain/coin/knownTokens'
import { getTokenMetadata } from '@vultisig/core-chain/coin/token/metadata'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TokenDiscoveryService } from '../../../../src/vault/services/TokenDiscoveryService'

vi.mock('@vultisig/core-chain/coin/find', () => ({ findCoins: vi.fn() }))
vi.mock('@vultisig/core-chain/coin/token/metadata', () => ({ getTokenMetadata: vi.fn() }))

const mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const service = new TokenDiscoveryService(async () => 'discovery-address')

describe('TokenDiscoveryService real curated registry', () => {
  beforeEach(() => vi.clearAllMocks())

  it('resolves canonical non-EVM IDs without metadata requests', async () => {
    for (const chain of [Chain.Solana, Chain.Ripple, Chain.Ton]) {
      for (const coin of knownTokens[chain]) {
        expect(await service.resolveToken(chain, coin.id!)).toMatchObject({ tokenId: coin.id, ticker: coin.ticker })
      }
    }
    expect(getTokenMetadata).not.toHaveBeenCalled()
  })

  it('resolves mixed-case EVM addresses to canonical IDs', async () => {
    expect(await service.resolveToken(Chain.Ethereum, usdc.id.toUpperCase())).toMatchObject({ tokenId: usdc.id })
    expect(getTokenMetadata).not.toHaveBeenCalled()
  })

  it('passes an altered identifier unchanged to the metadata fallback', async () => {
    const id = mint.toLowerCase()
    vi.mocked(getTokenMetadata).mockResolvedValue({ ticker: 'OTHER', decimals: 9 })
    expect(await service.resolveToken(Chain.Solana, id)).toMatchObject({ tokenId: id, ticker: 'OTHER', decimals: 9 })
    expect(getTokenMetadata).toHaveBeenCalledExactlyOnceWith({ chain: Chain.Solana, id })
  })

  it('does not enrich a case-mutated mint with the genuine token ticker', async () => {
    vi.mocked(findCoins).mockResolvedValue([
      { chain: Chain.Solana, address: 'discovery-address', id: mint, ticker: 'UPSTREAM', decimals: 6 },
      { chain: Chain.Solana, address: 'discovery-address', id: mint.toLowerCase(), ticker: 'OTHER', decimals: 9 },
    ])
    expect((await service.discoverTokens(Chain.Solana)).map(coin => coin.ticker)).toEqual(['USDC', 'OTHER'])
  })
})
