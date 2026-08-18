import { describe, expect, it } from 'vitest'

import {
  classifyTokenInput,
  findContractIdentity,
  normalizeTokenCandidates,
  pickClearTokenCandidate,
} from '../../../../src/tools/token/tokenSelection'

const ETH_PEPE = '0x6982508145454ce325ddbe47a25d4ec3d2311933'
const SOL_MINT = '6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN'
const TRON_USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'

function coin(
  id: string,
  name: string,
  symbol: string,
  deployments: { chain: string; contractAddress: string; decimals?: number }[] = []
) {
  return { id, name, symbol, marketCapRank: 123, deployments }
}

describe('classifyTokenInput', () => {
  it('classifies EVM contracts, Solana mints, Tron contracts, IBC denoms, and symbols', () => {
    expect(classifyTokenInput(ETH_PEPE)).toBe('evm_contract')
    expect(classifyTokenInput(SOL_MINT, 'Solana')).toBe('solana_mint')
    expect(classifyTokenInput(SOL_MINT)).toBe('native_or_symbol')
    expect(classifyTokenInput(TRON_USDT, 'Tron')).toBe('tron_contract')
    expect(classifyTokenInput(TRON_USDT)).toBe('native_or_symbol')
    expect(classifyTokenInput('ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2')).toBe(
      'cosmos_ibc'
    )
    expect(classifyTokenInput('USDC')).toBe('native_or_symbol')
  })
})

describe('normalizeTokenCandidates', () => {
  it('uppercases symbols, records exact-match flags, and filters by chain', () => {
    const candidates = normalizeTokenCandidates(
      'pepe',
      [
        coin('pepe', 'Pepe', 'pepe', [{ chain: 'Ethereum', contractAddress: ETH_PEPE, decimals: 18 }]),
        coin('pepe-sol', 'Pepe Sol', 'pepe', [{ chain: 'Solana', contractAddress: SOL_MINT }]),
      ],
      'Ethereum'
    )

    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({
      order: 1,
      coingeckoId: 'pepe',
      symbol: 'PEPE',
      match: {
        matched_symbol_exactly: true,
        matched_name_exactly: true,
        matched_id_exactly: true,
      },
    })
    expect(candidates[0].deployments).toEqual([{ chain: 'Ethereum', contractAddress: ETH_PEPE, decimals: 18 }])
  })
})

describe('pickClearTokenCandidate', () => {
  it('returns the only candidate', () => {
    const [only] = normalizeTokenCandidates('btc', [coin('bitcoin', 'Bitcoin', 'btc')])
    expect(pickClearTokenCandidate([only])).toBe(only)
  })

  it('returns a unique exact-id winner at order 1', () => {
    const candidates = normalizeTokenCandidates('pepe', [
      coin('pepe', 'Pepe', 'pepe', [{ chain: 'Ethereum', contractAddress: ETH_PEPE }]),
      coin('pepe-2', 'Pepe 2', 'pepe2'),
    ])
    expect(pickClearTokenCandidate(candidates)?.coingeckoId).toBe('pepe')
  })

  it('returns undefined when two exact-symbol hits make the winner unclear', () => {
    const candidates = normalizeTokenCandidates('usdc', [
      coin('usd-coin', 'USD Coin', 'usdc'),
      coin('bridged-usdc', 'Bridged USDC', 'usdc'),
    ])
    expect(pickClearTokenCandidate(candidates)).toBeUndefined()
  })

  it('returns undefined for an empty set', () => {
    expect(pickClearTokenCandidate([])).toBeUndefined()
  })
})

describe('findContractIdentity', () => {
  it('finds contract identity case-insensitively for EVM and case-sensitively for Solana', () => {
    const results = [
      coin('pepe', 'Pepe', 'pepe', [{ chain: 'Ethereum', contractAddress: ETH_PEPE, decimals: 18 }]),
      coin('official-trump', 'Official Trump', 'trump', [{ chain: 'Solana', contractAddress: SOL_MINT }]),
    ]

    expect(findContractIdentity(ETH_PEPE.toUpperCase(), results, 'Ethereum')).toEqual({
      symbol: 'PEPE',
      name: 'Pepe',
      coingeckoId: 'pepe',
      decimals: 18,
    })
    expect(findContractIdentity(SOL_MINT.toLowerCase(), results, 'Solana')).toBeUndefined()
    expect(findContractIdentity(SOL_MINT, results, 'Solana')).toEqual({
      symbol: 'TRUMP',
      name: 'Official Trump',
      coingeckoId: 'official-trump',
    })
  })
})
