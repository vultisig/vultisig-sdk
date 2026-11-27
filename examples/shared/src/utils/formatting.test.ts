import { describe, expect, it } from 'vitest'

import { getChainNativeDecimals, getChainNativeTicker, isUtxoChain } from './formatting'

// Regression for the local-map drift found in VaultSend/VaultSwap: these chains
// were previously missing (or wrong) in the hand-rolled tickerMap/decimalsMap
// copies before both were replaced with the SDK's canonical chainFeeCoin.
describe('getChainNativeTicker / getChainNativeDecimals', () => {
  it.each([
    ['Ton', 'GRAM', 9],
    ['Noble', 'USDC', 6],
    ['Tron', 'TRX', 6],
    ['Polygon', 'POL', 18],
    ['Mantle', 'MNT', 18],
    ['Hyperliquid', 'HYPE', 18],
    ['Sei', 'SEI', 18],
  ])('resolves %s to canonical ticker %s and decimals %d', (chain, ticker, decimals) => {
    expect(getChainNativeTicker(chain)).toBe(ticker)
    expect(getChainNativeDecimals(chain)).toBe(decimals)
  })

  it('falls back to the chain name / 18 decimals for an unrecognized chain', () => {
    expect(getChainNativeTicker('NotARealChain')).toBe('NotARealChain')
    expect(getChainNativeDecimals('NotARealChain')).toBe(18)
  })
})

describe('isUtxoChain', () => {
  it.each(['Bitcoin', 'Bitcoin-Cash', 'Litecoin', 'Dogecoin', 'Dash', 'Zcash'])(
    'returns true for UTXO chain %s',
    chain => {
      expect(isUtxoChain(chain)).toBe(true)
    }
  )

  it.each(['Ethereum', 'Solana', 'Cardano', 'Cosmos', 'NotARealChain', ''])(
    'returns false for non-UTXO chain %s',
    chain => {
      expect(isUtxoChain(chain)).toBe(false)
    }
  )
})
