import { describe, expect, it } from 'vitest'

import { Chain } from '../../../Chain'
import { getSwapKitTrackerUrl, swapKitTrackerChainIds } from './getSwapKitTrackerUrl'

describe('getSwapKitTrackerUrl', () => {
  it.each([
    [Chain.Ethereum, '1'],
    [Chain.Arbitrum, '42161'],
    [Chain.Avalanche, '43114'],
    [Chain.Base, '8453'],
    [Chain.BSC, '56'],
    [Chain.Polygon, '137'],
    [Chain.Optimism, '10'],
    [Chain.Blast, '81457'],
    [Chain.Zksync, '324'],
    [Chain.Tron, '728126428'],
    [Chain.Cardano, 'cardano'],
    [Chain.Ton, 'ton'],
    [Chain.Solana, 'solana'],
    [Chain.Bitcoin, 'bitcoin'],
    [Chain.BitcoinCash, 'bitcoincash'],
    [Chain.Litecoin, 'litecoin'],
    [Chain.Ripple, 'ripple'],
    [Chain.Cosmos, 'cosmoshub-4'],
    [Chain.Dash, 'dash'],
    [Chain.Zcash, 'zcash'],
    [Chain.Sui, 'sui'],
    [Chain.Dogecoin, 'dogecoin'],
    [Chain.Kujira, 'kaiyo-1'],
    [Chain.MayaChain, 'mayachain-mainnet-v1'],
    [Chain.THORChain, 'thorchain-1'],
  ])('maps %s to chainId=%s', (chain, chainId) => {
    expect(getSwapKitTrackerUrl({ chain, txHash: '0xabc123' })).toBe(
      `https://track.swapkit.dev/?hash=0xabc123&chainId=${chainId}`
    )
  })

  it('keeps the map and the test matrix exhaustive', () => {
    expect(Object.keys(swapKitTrackerChainIds)).toHaveLength(25)
  })

  it('encodes the hash without altering it', () => {
    expect(getSwapKitTrackerUrl({ chain: Chain.Solana, txHash: 'hash+with/slash=' })).toBe(
      'https://track.swapkit.dev/?hash=hash%2Bwith%2Fslash%3D&chainId=solana'
    )
  })

  it('returns null for a chain without a tracker mapping', () => {
    expect(getSwapKitTrackerUrl({ chain: Chain.Polkadot, txHash: '0xabc123' })).toBeNull()
  })
})
