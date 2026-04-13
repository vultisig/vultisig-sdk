import { Chain } from '@vultisig/core-chain/Chain'
import { describe, expect, it } from 'vitest'

import { resolvePairedAddressForLpAdd } from './pairing'

const vaultWithBoth = {
  [Chain.THORChain]: 'thor1qtest',
  [Chain.Bitcoin]: 'bc1qtest',
  [Chain.Ethereum]: '0xtest',
  [Chain.Dogecoin]: 'DTest',
}

describe('resolvePairedAddressForLpAdd', () => {
  it('RUNE-side add: returns the vault address on the pools asset chain', () => {
    expect(
      resolvePairedAddressForLpAdd({
        pool: 'BTC.BTC',
        side: 'rune',
        vaultAddresses: vaultWithBoth,
      })
    ).toBe('bc1qtest')
  })

  it('RUNE-side add: works for Dogecoin', () => {
    expect(
      resolvePairedAddressForLpAdd({
        pool: 'DOGE.DOGE',
        side: 'rune',
        vaultAddresses: vaultWithBoth,
      })
    ).toBe('DTest')
  })

  it('RUNE-side add: works for ERC-20 pools', () => {
    expect(
      resolvePairedAddressForLpAdd({
        pool: 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48',
        side: 'rune',
        vaultAddresses: vaultWithBoth,
      })
    ).toBe('0xtest')
  })

  it('asset-side add: returns the vault THORChain address regardless of pool', () => {
    expect(
      resolvePairedAddressForLpAdd({
        pool: 'BTC.BTC',
        side: 'asset',
        vaultAddresses: vaultWithBoth,
      })
    ).toBe('thor1qtest')

    expect(
      resolvePairedAddressForLpAdd({
        pool: 'ETH.ETH',
        side: 'asset',
        vaultAddresses: vaultWithBoth,
      })
    ).toBe('thor1qtest')
  })

  it('RUNE-side add: returns undefined when the asset-chain address is missing', () => {
    expect(
      resolvePairedAddressForLpAdd({
        pool: 'BTC.BTC',
        side: 'rune',
        vaultAddresses: { [Chain.THORChain]: 'thor1only' },
      })
    ).toBeUndefined()
  })

  it('asset-side add: returns undefined when the thor address is missing', () => {
    expect(
      resolvePairedAddressForLpAdd({
        pool: 'BTC.BTC',
        side: 'asset',
        vaultAddresses: { [Chain.Bitcoin]: 'bc1q' },
      })
    ).toBeUndefined()
  })

  it('returns undefined for unknown chain prefix', () => {
    expect(
      resolvePairedAddressForLpAdd({
        pool: 'ZZZ.ZZZ',
        side: 'rune',
        vaultAddresses: vaultWithBoth,
      })
    ).toBeUndefined()
  })

  it('throws on invalid pool id format', () => {
    expect(() =>
      resolvePairedAddressForLpAdd({
        pool: 'btc.btc',
        side: 'rune',
        vaultAddresses: vaultWithBoth,
      })
    ).toThrow(/valid THORChain pool id/)
  })
})
