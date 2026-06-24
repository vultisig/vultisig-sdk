import { decodeFunctionData } from 'viem'
import { describe, expect, it } from 'vitest'

import { RIVER_BORROWER_OPS_ABI, RIVER_PERIPHERY_ABI } from '../../../../src/tools/defi/river/abi'
import { RIVER_CHAIN_CONFIG } from '../../../../src/tools/defi/river/constants'
import {
  buildRiverCloseTrove,
  buildRiverDelegateApproval,
  buildRiverOpenTrove,
} from '../../../../src/tools/defi/river/river'

const TROVE_MANAGER = '0x1111111111111111111111111111111111111111' as const
const UPPER_HINT = '0x2222222222222222222222222222222222222222' as const
const LOWER_HINT = '0x3333333333333333333333333333333333333333' as const
// Checksummed address — exercises getAddress normalization in meta
const TROVE_MANAGER_CHECKSUM = '0xddac7d4e228c205197FE9961865FFE20173dE56B' as const

describe('sdk.defi.river', () => {
  describe('buildRiverDelegateApproval', () => {
    it('targets the app diamond and encodes setDelegateApproval(periphery, true)', () => {
      const { tx, meta } = buildRiverDelegateApproval({ chain: 'Ethereum' })
      const config = RIVER_CHAIN_CONFIG.Ethereum

      expect(tx.to).toBe(config.app)
      expect(tx.value).toBe('0')
      expect(tx.chainId).toBe(1)

      const decoded = decodeFunctionData({ abi: RIVER_BORROWER_OPS_ABI, data: tx.data })
      expect(decoded.functionName).toBe('setDelegateApproval')
      expect(decoded.args[0]).toBe(config.periphery)
      expect(decoded.args[1]).toBe(true)
      expect(meta.approved).toBe(true)
      expect(meta.delegate).toBe(config.periphery)
    })

    it('encodes revocation when approved=false', () => {
      const { tx } = buildRiverDelegateApproval({ chain: 'Base', approved: false })
      const decoded = decodeFunctionData({ abi: RIVER_BORROWER_OPS_ABI, data: tx.data })
      expect(decoded.args[1]).toBe(false)
    })
  })

  describe('buildRiverOpenTrove (offline w/ explicit hints)', () => {
    it('encodes selector 0x88ca8da6 with correct arg layout and hints, no RPC', async () => {
      const { tx, meta } = await buildRiverOpenTrove({
        chain: 'Arbitrum',
        troveManager: TROVE_MANAGER,
        collateralAmount: 1_000_000_000_000_000_000n, // 1 WETH
        debtAmount: 2_000_000_000_000_000_000_000n, // 2000 satUSD
        upperHint: UPPER_HINT,
        lowerHint: LOWER_HINT,
        affiliate: { maxFeeBps: 250, affiliateTag: 'consumer-xyz' },
      })
      const config = RIVER_CHAIN_CONFIG.Arbitrum

      expect(tx.to).toBe(config.periphery)
      expect(tx.chainId).toBe(42161)
      // Verify canonical selector 0x88ca8da6 — no leading account, trailing lzSendParam
      expect(tx.data.slice(0, 10)).toBe('0x88ca8da6')

      const decoded = decodeFunctionData({ abi: RIVER_PERIPHERY_ABI, data: tx.data })
      expect(decoded.functionName).toBe('openTrove')
      // layout: troveManager, maxFeePercentage, collAmount, debtAmount, upperHint, lowerHint, lzSendParam
      expect(decoded.args[0]).toBe(TROVE_MANAGER)
      // maxFeePercentage WAD: 250 bps = 2.5% = 0.025e18
      expect(decoded.args[1]).toBe(25_000_000_000_000_000n)
      expect(decoded.args[2]).toBe(1_000_000_000_000_000_000n)
      expect(decoded.args[3]).toBe(2_000_000_000_000_000_000_000n)
      expect(decoded.args[4]).toBe(UPPER_HINT)
      expect(decoded.args[5]).toBe(LOWER_HINT)
      // lzSendParam: all-zeros for same-chain
      expect(decoded.args[6]).toMatchObject({ dstEid: 0, options: '0x', fee: { nativeFee: 0n, lzTokenFee: 0n } })

      expect(meta.maxFeeBps).toBe(250)
      expect(meta.affiliateTag).toBe('consumer-xyz')
      // collateral token unknown offline -> conservatively treat as ERC-20 collateral
      expect(meta.collateralApprovalRequired).toBe(true)
      expect(tx.value).toBe('0')
    })

    it('pins against real Base openTrove tx (0x9017d0cb) — checksummed troveManager, 5% fee', async () => {
      // Real on-chain tx verified by NeOMakinG, selector 0x88ca8da6 dominant (16/50 recent Base txs)
      const { tx } = await buildRiverOpenTrove({
        chain: 'Base',
        troveManager: TROVE_MANAGER_CHECKSUM,
        collateralAmount: 4_700_000_000_000_000_000n, // 4.7 WETH
        debtAmount: 7_000_000_000_000_000_000_000n, // 7000 satUSD
        upperHint: '0x655132314E811fEfB7508347609dAd2463C736b8',
        lowerHint: '0x58C4f03a954e4CbB1b8E204a881a8e9A99d015Dd',
      })
      expect(tx.data.slice(0, 10)).toBe('0x88ca8da6')
      const decoded = decodeFunctionData({ abi: RIVER_PERIPHERY_ABI, data: tx.data })
      // 5% default = 0x0b1a2bc2ec500000 = 50000000000000000
      expect(decoded.args[1]).toBe(50_000_000_000_000_000n)
      expect(decoded.args[2]).toBe(4_700_000_000_000_000_000n)
      expect(decoded.args[3]).toBe(7_000_000_000_000_000_000_000n)
    })

    it('defaults to neutral fee tolerance (500 bps / 5%) and no affiliate tag', async () => {
      const { meta } = await buildRiverOpenTrove({
        chain: 'Ethereum',
        troveManager: TROVE_MANAGER,
        collateralAmount: 5n,
        debtAmount: 10n,
        upperHint: UPPER_HINT,
        lowerHint: LOWER_HINT,
      })
      expect(meta.maxFeeBps).toBe(500)
      expect(meta.maxFeePercentageWad).toBe('50000000000000000') // 0.05e18
      expect(meta.affiliateTag).toBeNull()
    })

    it('carries collateral as tx.value when collateralIsNative is set (offline native open)', async () => {
      const { tx, meta } = await buildRiverOpenTrove({
        chain: 'Ethereum',
        troveManager: TROVE_MANAGER,
        collateralAmount: 1_000_000_000_000_000_000n,
        debtAmount: 2_000_000_000_000_000_000_000n,
        upperHint: UPPER_HINT,
        lowerHint: LOWER_HINT,
        collateralIsNative: true,
      })
      // value MUST equal the encoded collAmount for a native open, else it reverts.
      expect(tx.value).toBe('1000000000000000000')
      const decoded = decodeFunctionData({ abi: RIVER_PERIPHERY_ABI, data: tx.data })
      expect(decoded.args[2]).toBe(1_000_000_000_000_000_000n) // collAmount at index 2
      expect(meta.nativeCollateral).toBe(true)
      expect(meta.collateralApprovalRequired).toBe(false)
      expect(meta.collateralApprovalSpender).toBeNull()
    })

    it('defaults offline opens to ERC-20 (value 0, approval required) when nativeness undeclared', async () => {
      const { tx, meta } = await buildRiverOpenTrove({
        chain: 'Ethereum',
        troveManager: TROVE_MANAGER,
        collateralAmount: 5n,
        debtAmount: 10n,
        upperHint: UPPER_HINT,
        lowerHint: LOWER_HINT,
      })
      expect(tx.value).toBe('0')
      expect(meta.nativeCollateral).toBe(false)
      expect(meta.collateralApprovalRequired).toBe(true)
    })

    it('rejects non-positive collateral and debt amounts', async () => {
      await expect(
        buildRiverOpenTrove({
          chain: 'Ethereum',
          troveManager: TROVE_MANAGER,
          collateralAmount: 0n,
          debtAmount: 10n,
          upperHint: UPPER_HINT,
          lowerHint: LOWER_HINT,
        })
      ).rejects.toThrow(/collateralAmount/)
      await expect(
        buildRiverOpenTrove({
          chain: 'Ethereum',
          troveManager: TROVE_MANAGER,
          collateralAmount: 5n,
          debtAmount: 0n,
          upperHint: UPPER_HINT,
          lowerHint: LOWER_HINT,
        })
      ).rejects.toThrow(/debtAmount/)
    })

    it('rejects out-of-range fee tolerance', async () => {
      await expect(
        buildRiverOpenTrove({
          chain: 'Ethereum',
          troveManager: TROVE_MANAGER,
          collateralAmount: 5n,
          debtAmount: 10n,
          upperHint: UPPER_HINT,
          lowerHint: LOWER_HINT,
          affiliate: { maxFeeBps: 9999 },
        })
      ).rejects.toThrow(/maxFeeBps/)
    })
  })

  describe('buildRiverCloseTrove', () => {
    it('encodes closeTrove(troveManager) and flags satUSD approval, offline', () => {
      const { tx, meta } = buildRiverCloseTrove({ chain: 'BSC', troveManager: TROVE_MANAGER })
      const config = RIVER_CHAIN_CONFIG.BSC

      expect(tx.to).toBe(config.periphery)
      expect(tx.value).toBe('0')
      expect(tx.chainId).toBe(56)

      const decoded = decodeFunctionData({ abi: RIVER_PERIPHERY_ABI, data: tx.data })
      expect(decoded.functionName).toBe('closeTrove')
      expect(decoded.args[0]).toBe(TROVE_MANAGER)

      expect(meta.satUsdApprovalRequired).toBe(true)
      expect(meta.satUsdApprovalSpender).toBe(config.periphery)
    })
  })
})
