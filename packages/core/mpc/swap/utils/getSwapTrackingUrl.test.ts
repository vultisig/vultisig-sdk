import { Chain } from '@vultisig/core-chain/Chain'
import { describe, expect, it } from 'vitest'

import { getSwapTrackingUrl } from './getSwapTrackingUrl'

const HASH = '0xabc123'

describe('getSwapTrackingUrl', () => {
  describe('general / swapkit provider', () => {
    it('routes to track.swapkit.dev for EVM source chains', () => {
      const url = getSwapTrackingUrl({
        swapPayload: { general: { provider: 'swapkit' } as any },
        txHash: HASH,
        sourceChain: Chain.Ethereum,
      })
      expect(url).toBe(`https://track.swapkit.dev/?tx=${HASH}&chainId=1`)
    })

    it('uses the correct numeric chainId for Polygon', () => {
      const url = getSwapTrackingUrl({
        swapPayload: { general: { provider: 'swapkit' } as any },
        txHash: HASH,
        sourceChain: Chain.Polygon,
      })
      expect(url).toBe(`https://track.swapkit.dev/?tx=${HASH}&chainId=137`)
    })

    it('uses slug chainId for Bitcoin', () => {
      const url = getSwapTrackingUrl({
        swapPayload: { general: { provider: 'swapkit' } as any },
        txHash: HASH,
        sourceChain: Chain.Bitcoin,
      })
      expect(url).toBe(`https://track.swapkit.dev/?tx=${HASH}&chainId=bitcoin`)
    })

    it('uses slug chainId for Solana', () => {
      const url = getSwapTrackingUrl({
        swapPayload: { general: { provider: 'swapkit' } as any },
        txHash: HASH,
        sourceChain: Chain.Solana,
      })
      expect(url).toBe(`https://track.swapkit.dev/?tx=${HASH}&chainId=solana`)
    })
  })

  describe('general / li.fi provider', () => {
    it('routes to scan.li.fi (unchanged)', () => {
      const url = getSwapTrackingUrl({
        swapPayload: { general: { provider: 'li.fi' } as any },
        txHash: HASH,
        sourceChain: Chain.Ethereum,
      })
      expect(url).toBe(`https://scan.li.fi/tx/${HASH}`)
    })
  })

  describe('general / other providers', () => {
    it('falls back to block explorer for 1inch', () => {
      const url = getSwapTrackingUrl({
        swapPayload: { general: { provider: '1inch' } as any },
        txHash: HASH,
        sourceChain: Chain.Ethereum,
      })
      expect(url).toBe(`https://etherscan.io/tx/${HASH}`)
    })
  })

  describe('native / THORChain', () => {
    it('routes to runescan.io and strips 0x prefix (unchanged)', () => {
      const url = getSwapTrackingUrl({
        swapPayload: { native: { chain: Chain.THORChain } as any },
        txHash: HASH,
        sourceChain: Chain.THORChain,
      })
      // stripHexPrefix removes the leading 0x from the hash
      expect(url).toBe(`https://runescan.io/tx/abc123`)
    })
  })
})
