/**
 * Tests for getTronChainSpecific — native TRX fee estimation with
 * free-bandwidth awareness.
 *
 * Tron grants ~1500 free bandwidth/day per account; a native TRX transfer
 * costs ~300 bytes. Users whose bandwidth isn't exhausted should see 0n fee,
 * not the 800k sun worst-case shown previously (R2 audit finding #3).
 *
 * Logic mirrors iOS TronService.swift lines 160-175.
 */
import { initWasm, type WalletCore } from '@trustwallet/wallet-core'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — must be at top level for vi.mock hoisting
// ---------------------------------------------------------------------------

const blockInfo = vi.hoisted(() => ({
  timestamp: 1_716_000_000_000,
  expiration: 1_716_003_600_000,
  blockHeaderTimestamp: 1_716_000_000_000,
  blockHeaderNumber: 99_000_000,
  blockHeaderVersion: 30,
  blockHeaderTxTrieRoot: '01'.repeat(32),
  blockHeaderParentHash: '02'.repeat(32),
  blockHeaderWitnessAddress: '03'.repeat(21),
}))

vi.mock('@vultisig/core-chain/chains/tron/getTronBlockInfo', () => ({
  getTronBlockInfo: vi.fn().mockResolvedValue(blockInfo),
}))

vi.mock('@vultisig/core-chain/chains/tron/resources/getTronAccountResources', () => ({
  getTronAccountResources: vi.fn(),
}))

// isFeeCoin returns true for the native TRX coin (no contractAddress / id)
vi.mock('@vultisig/core-chain/coin/utils/isFeeCoin', () => ({
  isFeeCoin: vi.fn((coin: any) => !coin.id),
}))

import { getTronAccountResources } from '@vultisig/core-chain/chains/tron/resources/getTronAccountResources'
import { getNativeTronBandwidthBytes, getTronChainSpecific } from './index.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const OWNER = 'TCNkawTmcQgYSU8nP8cHswT1QPjharxJr7'
const RECIPIENT = 'THHsfg2eNiv6MSXC4y5d4t5wkvRVADRKiF'

function makeTrxPayload(memo = '', fromAddress = OWNER) {
  return {
    toAmount: '1000000',
    toAddress: RECIPIENT,
    memo,
    coin: {
      chain: 'tron' as any,
      address: fromAddress,
      ticker: 'TRX',
      decimals: 6,
      // no id => isFeeCoin returns true
    },
  } as any
}

function makeBandwidthResources(available: number) {
  return {
    bandwidth: { available, total: 1500, used: 1500 - available },
    energy: { available: 0, total: 0, used: 0 },
    frozenForBandwidthSun: 0n,
    frozenForEnergySun: 0n,
    unfreezingEntries: [],
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getTronChainSpecific — native TRX bandwidth fee check', () => {
  let walletCore: WalletCore

  beforeAll(async () => {
    walletCore = await initWasm()
  })

  beforeEach(() => {
    vi.mocked(getTronAccountResources).mockReset()
  })

  const resolve = (memo = '') =>
    getTronChainSpecific({
      keysignPayload: makeTrxPayload(memo),
      walletCore,
      thirdPartyGasLimitEstimation: undefined,
      expiration: undefined,
      timestamp: undefined,
      refBlockBytesHex: undefined,
      refBlockHashHex: undefined,
    })

  it('returns 0n fee when sender has ample free bandwidth (happy path)', async () => {
    // Fresh account: 1500 free bandwidth, none used
    vi.mocked(getTronAccountResources).mockResolvedValue(makeBandwidthResources(1500))

    const result = await resolve()

    expect(result.gasEstimation).toBe(0n)
  })

  it('returns 800_000n when bandwidth is fully exhausted', async () => {
    // 1500/1500 used, 0 staked => available = 0
    vi.mocked(getTronAccountResources).mockResolvedValue(makeBandwidthResources(0))

    const result = await resolve()

    expect(result.gasEstimation).toBe(800_000n)
  })

  it('uses TRON protocol bandwidth consumption, including signed bytes, result allowance, and UTF-8 memo framing', () => {
    const required = (memo: string) =>
      getNativeTronBandwidthBytes({
        walletCore,
        fromAddress: OWNER,
        toAddress: RECIPIENT,
        amount: 1_000_000n,
        memo,
        blockInfo,
      })

    const withoutMemo = required('')
    const asciiMemo = required('memo')
    const multibyteMemo = required('memo💸')

    expect(withoutMemo).toBe(267)
    expect(asciiMemo).toBe(273)
    expect(multibyteMemo).toBe(277)
    expect(asciiMemo - withoutMemo).toBe(2 + Buffer.byteLength('memo'))
    expect(multibyteMemo - withoutMemo).toBe(2 + Buffer.byteLength('memo💸'))
  })

  it.each(['', 'memo', 'memo💸'])(
    'charges when available bandwidth is one byte below the %s transaction size',
    async memo => {
      const requiredBandwidth = getNativeTronBandwidthBytes({
        walletCore,
        fromAddress: OWNER,
        toAddress: RECIPIENT,
        amount: 1_000_000n,
        memo,
        blockInfo,
      })
      vi.mocked(getTronAccountResources).mockResolvedValue(makeBandwidthResources(requiredBandwidth - 1))

      await expect(resolve(memo)).resolves.toMatchObject({ gasEstimation: 800_000n })
    }
  )

  it('falls back to 800_000n gracefully when resource RPC throws', async () => {
    vi.mocked(getTronAccountResources).mockRejectedValue(new Error('503 Service Unavailable'))

    const result = await resolve()

    // Graceful degradation: don't block the send, use worst-case fee
    expect(result.gasEstimation).toBe(800_000n)
  })

  it('returns 0n when available bandwidth exactly equals the memo-bearing signed size', async () => {
    const memo = 'memo💸'
    const requiredBandwidth = getNativeTronBandwidthBytes({
      walletCore,
      fromAddress: OWNER,
      toAddress: RECIPIENT,
      amount: 1_000_000n,
      memo,
      blockInfo,
    })
    vi.mocked(getTronAccountResources).mockResolvedValue(makeBandwidthResources(requiredBandwidth))

    const result = await resolve(memo)

    expect(result.gasEstimation).toBe(0n)
  })

  it('honours thirdPartyGasLimitEstimation when provided, skipping bandwidth check', async () => {
    vi.mocked(getTronAccountResources).mockResolvedValue(makeBandwidthResources(1500))

    const result = await getTronChainSpecific({
      keysignPayload: makeTrxPayload(),
      walletCore,
      thirdPartyGasLimitEstimation: 1_234_567n,
      expiration: undefined,
      timestamp: undefined,
      refBlockBytesHex: undefined,
      refBlockHashHex: undefined,
    })

    expect(result.gasEstimation).toBe(1_234_567n)
    expect(getTronAccountResources).not.toHaveBeenCalled()
  })
})
