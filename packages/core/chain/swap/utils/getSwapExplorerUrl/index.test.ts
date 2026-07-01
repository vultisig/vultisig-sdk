import { Chain } from '@vultisig/core-chain/Chain'
import { describe, expect, it } from 'vitest'

import { getSwapExplorerUrl, swapExplorerProviders } from './index'

// Realistic-shape txHashes (length and case match what each chain emits).
const EVM_TX_HASH = '0x9f8c2b1a4d3e5f6a7b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c'
const THOR_TX_HASH_NO_PREFIX = 'F1E2D3C4B5A6978869DECABFE1F2A3B4C5D6E7F8091A2B3C4D5E6F708192A3B4'
const MAYA_TX_HASH_NO_PREFIX = '0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF'
const SOL_TX_HASH = '5sN4Gd1cYpkqXf9PJ2vk3aHe8mLZbT9rsQwYjVtNcXkA6zBeLgFmHqWdYbCnRsVtUxKpJ8MzTwQhPgRfNlEd'

describe('getSwapExplorerUrl', () => {
  describe('li.fi', () => {
    it('uses scan.li.fi for EVM source chains and keeps the raw hash (incl. 0x)', () => {
      expect(
        getSwapExplorerUrl({
          provider: 'li.fi',
          txHash: EVM_TX_HASH,
          fromChain: Chain.Ethereum,
        })
      ).toBe(`https://scan.li.fi/tx/${EVM_TX_HASH}`)

      expect(
        getSwapExplorerUrl({
          provider: 'li.fi',
          txHash: EVM_TX_HASH,
          fromChain: Chain.Arbitrum,
        })
      ).toBe(`https://scan.li.fi/tx/${EVM_TX_HASH}`)
    })

    it('routes Solana cross-chain settlement to Helius (LI.FI has no per-tx page)', () => {
      expect(
        getSwapExplorerUrl({
          provider: 'li.fi',
          txHash: SOL_TX_HASH,
          fromChain: Chain.Solana,
        })
      ).toBe(`https://orb.helius.dev/tx/${SOL_TX_HASH}`)
    })
  })

  describe('thorchain', () => {
    it('strips a 0x prefix before composing the runescan URL', () => {
      expect(
        getSwapExplorerUrl({
          provider: 'thorchain',
          txHash: `0x${THOR_TX_HASH_NO_PREFIX}`,
          fromChain: Chain.THORChain,
        })
      ).toBe(`https://runescan.io/tx/${THOR_TX_HASH_NO_PREFIX}`)
    })

    it('leaves a hash that has no 0x prefix unchanged', () => {
      expect(
        getSwapExplorerUrl({
          provider: 'thorchain',
          txHash: THOR_TX_HASH_NO_PREFIX,
          fromChain: Chain.Bitcoin,
        })
      ).toBe(`https://runescan.io/tx/${THOR_TX_HASH_NO_PREFIX}`)
    })

    it('strips a capitalised 0X prefix the same way', () => {
      expect(
        getSwapExplorerUrl({
          provider: 'thorchain',
          txHash: `0X${THOR_TX_HASH_NO_PREFIX}`,
          fromChain: Chain.Ethereum,
        })
      ).toBe(`https://runescan.io/tx/${THOR_TX_HASH_NO_PREFIX}`)
    })
  })

  describe('mayachain', () => {
    it('strips a 0x prefix before composing the mayachain explorer URL', () => {
      expect(
        getSwapExplorerUrl({
          provider: 'mayachain',
          txHash: `0x${MAYA_TX_HASH_NO_PREFIX}`,
          fromChain: Chain.MayaChain,
        })
      ).toBe(`https://www.explorer.mayachain.info/tx/${MAYA_TX_HASH_NO_PREFIX}`)
    })

    it('leaves a hash that has no 0x prefix unchanged', () => {
      expect(
        getSwapExplorerUrl({
          provider: 'mayachain',
          txHash: MAYA_TX_HASH_NO_PREFIX,
          fromChain: Chain.Dash,
        })
      ).toBe(`https://www.explorer.mayachain.info/tx/${MAYA_TX_HASH_NO_PREFIX}`)
    })
  })

  describe('aggregators without a per-tx scanner', () => {
    it('1inch falls back to the source-chain block explorer', () => {
      expect(
        getSwapExplorerUrl({
          provider: '1inch',
          txHash: EVM_TX_HASH,
          fromChain: Chain.Ethereum,
        })
      ).toBe(`https://etherscan.io/tx/${EVM_TX_HASH}`)

      expect(
        getSwapExplorerUrl({
          provider: '1inch',
          txHash: EVM_TX_HASH,
          fromChain: Chain.Polygon,
        })
      ).toBe(`https://polygonscan.com/tx/${EVM_TX_HASH}`)
    })

    it('kyber falls back to the source-chain block explorer', () => {
      expect(
        getSwapExplorerUrl({
          provider: 'kyber',
          txHash: EVM_TX_HASH,
          fromChain: Chain.Base,
        })
      ).toBe(`https://basescan.org/tx/${EVM_TX_HASH}`)
    })

    it('swapkit falls back to the source-chain block explorer', () => {
      expect(
        getSwapExplorerUrl({
          provider: 'swapkit',
          txHash: SOL_TX_HASH,
          fromChain: Chain.Solana,
        })
      ).toBe(`https://solscan.io/tx/${SOL_TX_HASH}`)
    })

    it('jupiter falls back to the Solana block explorer', () => {
      expect(
        getSwapExplorerUrl({
          provider: 'jupiter',
          txHash: SOL_TX_HASH,
          fromChain: Chain.Solana,
        })
      ).toBe(`https://solscan.io/tx/${SOL_TX_HASH}`)
    })
  })

  it('exposes every provider via swapExplorerProviders', () => {
    expect([...swapExplorerProviders].sort()).toEqual(
      ['1inch', 'kyber', 'li.fi', 'mayachain', 'swapkit', 'jupiter', 'thorchain'].sort()
    )
  })
})
