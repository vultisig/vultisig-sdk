import { Chain } from '@vultisig/core-chain/Chain'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getSwapTrackingUrl } from './getSwapTrackingUrl'

const EVM_HASH = '0xabc123'
// Real-shape UTXO hash — bare, no `0x` prefix. Tracks against
// track.swapkit.dev's expected format (NeOMakinG #527 r1).
const UTXO_HASH = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'

describe('getSwapTrackingUrl', () => {
  describe('general / swapkit provider', () => {
    it('routes to track.swapkit.dev for EVM source chains and strips 0x', () => {
      const url = getSwapTrackingUrl({
        swapPayload: { general: { provider: 'swapkit' } as any },
        txHash: EVM_HASH,
        sourceChain: Chain.Ethereum,
      })
      expect(url).toBe(`https://track.swapkit.dev/?tx=abc123&chainId=1`)
    })

    it('uses the correct numeric chainId for Polygon', () => {
      const url = getSwapTrackingUrl({
        swapPayload: { general: { provider: 'swapkit' } as any },
        txHash: EVM_HASH,
        sourceChain: Chain.Polygon,
      })
      expect(url).toBe(`https://track.swapkit.dev/?tx=abc123&chainId=137`)
    })

    it('uses slug chainId for Bitcoin AND passes UTXO hash through (no 0x prefix to strip)', () => {
      const url = getSwapTrackingUrl({
        swapPayload: { general: { provider: 'swapkit' } as any },
        txHash: UTXO_HASH,
        sourceChain: Chain.Bitcoin,
      })
      expect(url).toBe(`https://track.swapkit.dev/?tx=${UTXO_HASH}&chainId=bitcoin`)
    })

    it('uses slug chainId for Solana', () => {
      const url = getSwapTrackingUrl({
        swapPayload: { general: { provider: 'swapkit' } as any },
        txHash: EVM_HASH,
        sourceChain: Chain.Solana,
      })
      expect(url).toBe(`https://track.swapkit.dev/?tx=abc123&chainId=solana`)
    })

    describe('exhaustiveness warning when chain not in tracker map', () => {
      let warnSpy: ReturnType<typeof vi.spyOn>
      beforeEach(() => {
        warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      })
      afterEach(() => {
        warnSpy.mockRestore()
      })

      it('falls back to block explorer + warns when sourceChain has no tracker entry', () => {
        // THORChain is not in swapKitTrackerChainId, so it falls through.
        // Using THORChain here simulates a hypothetical SwapKitSourceChain
        // extension without a matching swapKitTrackerChainId update.
        const url = getSwapTrackingUrl({
          swapPayload: { general: { provider: 'swapkit' } as any },
          txHash: EVM_HASH,
          sourceChain: Chain.THORChain,
        })
        expect(url).toMatch(/runescan\.io|thorchain/i)
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('SwapKit tracker chainId missing for'))
      })
    })
  })

  describe('general / li.fi provider', () => {
    it('routes to scan.li.fi (unchanged)', () => {
      const url = getSwapTrackingUrl({
        swapPayload: { general: { provider: 'li.fi' } as any },
        txHash: EVM_HASH,
        sourceChain: Chain.Ethereum,
      })
      expect(url).toBe(`https://scan.li.fi/tx/${EVM_HASH}`)
    })
  })

  describe('general / other providers', () => {
    it('falls back to block explorer for 1inch', () => {
      const url = getSwapTrackingUrl({
        swapPayload: { general: { provider: '1inch' } as any },
        txHash: EVM_HASH,
        sourceChain: Chain.Ethereum,
      })
      expect(url).toBe(`https://etherscan.io/tx/${EVM_HASH}`)
    })
  })

  describe('native / THORChain', () => {
    it('routes to runescan.io and strips 0x prefix (unchanged)', () => {
      const url = getSwapTrackingUrl({
        swapPayload: { native: { chain: Chain.THORChain } as any },
        txHash: EVM_HASH,
        sourceChain: Chain.THORChain,
      })
      expect(url).toBe(`https://runescan.io/tx/abc123`)
    })
  })
})
