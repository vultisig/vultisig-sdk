import { Chain } from '@vultisig/core-chain/Chain'
import { describe, expect, it } from 'vitest'

import { getThorchainDepositAsset } from './index'

// sdk#1371: an unresolved chain id previously threw a bare
// "Cannot read properties of undefined (reading 'toUpperCase')" TypeError
// instead of a domain error naming the unresolved chain, only reachable on
// the secured=true path (`chainId.toUpperCase()`). Fails closed either way
// (no fund loss), but a useless diagnostic makes field failures hard to
// triage.
describe('getThorchainDepositAsset', () => {
  it('throws a domain error naming both unresolved chains instead of a bare TypeError', () => {
    expect(() =>
      getThorchainDepositAsset({
        assetCoin: { chain: 'Sui', ticker: 'SUI' },
        chain: Chain.Osmosis,
        secured: true,
      })
    ).toThrow(/Unresolved THORChain deposit-asset chain id.*"Sui".*"Osmosis"/)
  })

  it('throws the same domain error on the unsecured path too (chainId is unusable regardless)', () => {
    expect(() =>
      getThorchainDepositAsset({
        assetCoin: { chain: 'Sui', ticker: 'SUI' },
        chain: Chain.Osmosis,
        secured: false,
      })
    ).toThrow(/Unresolved THORChain deposit-asset chain id/)
  })

  it('resolves via assetCoin.chain when it has a native-swap chain id', () => {
    const result = getThorchainDepositAsset({
      assetCoin: { chain: Chain.Ethereum, ticker: 'USDC', contractAddress: '0xa0b8' },
      chain: Chain.THORChain,
      secured: true,
    })
    expect(result.chain).toBe('ETH')
    expect(result.symbol).toBe('USDC-0XA0B8')
  })

  it('resolves via the cosmos chain fallback when assetCoin.chain has no entry', () => {
    const result = getThorchainDepositAsset({
      assetCoin: { chain: Chain.Sui, ticker: 'TCY' },
      chain: Chain.THORChain,
      secured: false,
    })
    expect(result.chain).toBe('THOR')
  })
})
