import { Chain } from '@vultisig/core-chain/Chain'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getSwapTrackingUrl } from './getSwapTrackingUrl'

const EVM_HASH = '0xabc123'
// Real-shape UTXO hash -- bare 64-char hex, no `0x` prefix.
// Represents the human-readable txid form (byte-reversed double-SHA256
// for BTC/BCH/DOGE/LTC/ZEC), which is the format track.swapkit.dev expects.
// @see packages/core/chain/tx/hash/resolvers/utxo.ts -- signing layer emits
//   `Buffer.from(txid).reverse().toString('hex')` (byte-reversed display form).
const UTXO_HASH = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'
// XRP Ledger tx hashes are 64-char uppercase hex, forward byte-order
// (no reversal like UTXO chains). Distinct constant to document the contract.
const XRP_HASH = 'B4E2CF540C6F29C8A0A94FFF0ADB32E17BB49D3B3C6ED4DE3F8C5B0A7A6F9E2C'
// TON transaction hashes are hex-encoded (not base64).
// @see packages/core/chain/tx/hash/resolvers/ton.ts -- signing layer emits
//   `Buffer.from(hash).toString('hex')` (hex, no 0x prefix).
// encodeURIComponent is a no-op for standard hex chars.
const TON_HASH = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9'

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

    // Remaining mapped chains -- lock each chainId entry so map drift is caught immediately
    it.each([
      [Chain.Arbitrum, '42161', EVM_HASH, 'abc123'],
      [Chain.Avalanche, '43114', EVM_HASH, 'abc123'],
      [Chain.Base, '8453', EVM_HASH, 'abc123'],
      [Chain.BSC, '56', EVM_HASH, 'abc123'],
      [Chain.Optimism, '10', EVM_HASH, 'abc123'],
      // UTXO chains: bare hashes (no 0x). Byte-order is the human-readable
      // txid form (byte-reversed double-SHA256), which track.swapkit.dev expects.
      [Chain.BitcoinCash, 'bitcoincash', UTXO_HASH, UTXO_HASH],
      [Chain.Dogecoin, 'dogecoin', UTXO_HASH, UTXO_HASH],
      [Chain.Litecoin, 'litecoin', UTXO_HASH, UTXO_HASH],
      [Chain.Zcash, 'zcash', UTXO_HASH, UTXO_HASH],
      // Tron: decimal chain ID per SwapKit docs (not 0x2b6653cc hex form)
      [Chain.Tron, '728126428', UTXO_HASH, UTXO_HASH],
    ])('%s routes to track.swapkit.dev with chainId=%s', (chain, expectedChainId, hash, expectedHash) => {
      const url = getSwapTrackingUrl({
        swapPayload: { general: { provider: 'swapkit' } as any },
        txHash: hash,
        sourceChain: chain as Chain,
      })
      expect(url).toBe(`https://track.swapkit.dev/?tx=${expectedHash}&chainId=${expectedChainId}`)
    })

    it('XRP uses forward byte-order hash (distinct from UTXO chains, no reversal needed)', () => {
      // XRP Ledger tx hashes are 64-char uppercase hex, forward byte-order.
      const url = getSwapTrackingUrl({
        swapPayload: { general: { provider: 'swapkit' } as any },
        txHash: XRP_HASH,
        sourceChain: Chain.Ripple,
      })
      expect(url).toBe(`https://track.swapkit.dev/?tx=${XRP_HASH}&chainId=ripple`)
    })

    it('TON hex hash passes through (encodeURIComponent is no-op for hex)', () => {
      // TON hashes are hex-encoded (signing layer: Buffer.from(hash).toString('hex')).
      // No 0x prefix -- encodeURIComponent is a no-op for hex chars.
      const url = getSwapTrackingUrl({
        swapPayload: { general: { provider: 'swapkit' } as any },
        txHash: TON_HASH,
        sourceChain: Chain.Ton,
      })
      expect(url).toBe(`https://track.swapkit.dev/?tx=${TON_HASH}&chainId=ton`)
    })

    it('TON hash with 0x prefix throws (would silently corrupt hex hash)', () => {
      // Defensive guard: a 0x-prefixed TON hash indicates misconfigured upstream.
      // stripHexPrefix would strip the first two chars, producing a corrupted hash.
      expect(() =>
        getSwapTrackingUrl({
          swapPayload: { general: { provider: 'swapkit' } as any },
          txHash: `0x${TON_HASH}`,
          sourceChain: Chain.Ton,
        })
      ).toThrow('TON tx hash must not have a 0x prefix')
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
