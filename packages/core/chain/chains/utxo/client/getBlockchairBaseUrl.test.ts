import { OtherChain, UtxoChain } from '@vultisig/core-chain/Chain'
import { rootApiUrl } from '@vultisig/core-config'
import { describe, expect, it } from 'vitest'

import { getBlockchairBaseUrl } from './getBlockchairBaseUrl'

describe('getBlockchairBaseUrl', () => {
  it('builds the chain-scoped Blockchair proxy URL', () => {
    expect(getBlockchairBaseUrl(UtxoChain.Bitcoin)).toBe(`${rootApiUrl}/blockchair/bitcoin`)
  })

  it('lowercases a hyphenated chain name (Bitcoin-Cash)', () => {
    expect(getBlockchairBaseUrl(UtxoChain.BitcoinCash)).toBe(`${rootApiUrl}/blockchair/bitcoin-cash`)
  })

  it('supports Cardano, the non-UtxoChain member of UtxoBasedChain', () => {
    expect(getBlockchairBaseUrl(OtherChain.Cardano)).toBe(`${rootApiUrl}/blockchair/cardano`)
  })
})
