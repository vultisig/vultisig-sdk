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
import { describe, expect, it, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — must be at top level for vi.mock hoisting
// ---------------------------------------------------------------------------

vi.mock('@vultisig/core-chain/chains/tron/getTronBlockInfo', () => ({
  getTronBlockInfo: vi.fn().mockResolvedValue({
    timestamp: 1_716_000_000_000,
    expiration: 1_716_000_060_000,
    blockHeaderTimestamp: 1_716_000_000_000,
    blockHeaderNumber: 99_000_000,
    blockHeaderVersion: 30,
    blockHeaderTxTrieRoot: new Uint8Array(32),
    blockHeaderParentHash: new Uint8Array(32),
    blockHeaderWitnessAddress: new Uint8Array(21),
  }),
}))

vi.mock('@vultisig/core-chain/chains/tron/resources/getTronAccountResources', () => ({
  getTronAccountResources: vi.fn(),
}))

// isFeeCoin returns true for the native TRX coin (no contractAddress / id)
vi.mock('@vultisig/core-chain/coin/utils/isFeeCoin', () => ({
  isFeeCoin: vi.fn((coin: any) => !coin.id),
}))

import { getTronAccountResources } from '@vultisig/core-chain/chains/tron/resources/getTronAccountResources'
import { getTronChainSpecific } from './index.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTrxPayload(fromAddress = 'TFromAddress123') {
  return {
    toAmount: '1000000',
    toAddress: 'TToAddress456',
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
  beforeEach(() => {
    vi.mocked(getTronAccountResources).mockReset()
  })

  it('returns 0n fee when sender has ample free bandwidth (happy path)', async () => {
    // Fresh account: 1500 free bandwidth, none used
    vi.mocked(getTronAccountResources).mockResolvedValue(makeBandwidthResources(1500))

    const result = await getTronChainSpecific({
      keysignPayload: makeTrxPayload(),
      walletCore: {} as any,
      thirdPartyGasLimitEstimation: undefined,
      expiration: undefined,
      timestamp: undefined,
      refBlockBytesHex: undefined,
      refBlockHashHex: undefined,
    })

    expect(result.gasEstimation).toBe(0n)
  })

  it('returns 800_000n when bandwidth is fully exhausted', async () => {
    // 1500/1500 used, 0 staked => available = 0
    vi.mocked(getTronAccountResources).mockResolvedValue(makeBandwidthResources(0))

    const result = await getTronChainSpecific({
      keysignPayload: makeTrxPayload(),
      walletCore: {} as any,
      thirdPartyGasLimitEstimation: undefined,
      expiration: undefined,
      timestamp: undefined,
      refBlockBytesHex: undefined,
      refBlockHashHex: undefined,
    })

    expect(result.gasEstimation).toBe(800_000n)
  })

  it('returns 800_000n when available bandwidth is below 300-byte threshold', async () => {
    // 200 bytes available — not enough for a ~300 byte native transfer
    vi.mocked(getTronAccountResources).mockResolvedValue(makeBandwidthResources(200))

    const result = await getTronChainSpecific({
      keysignPayload: makeTrxPayload(),
      walletCore: {} as any,
      thirdPartyGasLimitEstimation: undefined,
      expiration: undefined,
      timestamp: undefined,
      refBlockBytesHex: undefined,
      refBlockHashHex: undefined,
    })

    expect(result.gasEstimation).toBe(800_000n)
  })

  it('falls back to 800_000n gracefully when resource RPC throws', async () => {
    vi.mocked(getTronAccountResources).mockRejectedValue(new Error('503 Service Unavailable'))

    const result = await getTronChainSpecific({
      keysignPayload: makeTrxPayload(),
      walletCore: {} as any,
      thirdPartyGasLimitEstimation: undefined,
      expiration: undefined,
      timestamp: undefined,
      refBlockBytesHex: undefined,
      refBlockHashHex: undefined,
    })

    // Graceful degradation: don't block the send, use worst-case fee
    expect(result.gasEstimation).toBe(800_000n)
  })

  it('honours thirdPartyGasLimitEstimation when provided, skipping bandwidth check', async () => {
    vi.mocked(getTronAccountResources).mockResolvedValue(makeBandwidthResources(1500))

    const result = await getTronChainSpecific({
      keysignPayload: makeTrxPayload(),
      walletCore: {} as any,
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
