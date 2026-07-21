/**
 * Tests for getTrc20TransferFee - correct endpoint, response-shape validation,
 * negative energy guard, sender's staked energy subtraction, and the
 * feeLimit margin/cap applied before returning.
 *
 * Mirrors iOS TronService.swift:117-126 intent.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: vi.fn(),
}))

vi.mock('@vultisig/core-chain/chains/tron/resources/getTronAccountResources', () => ({
  getTronAccountResources: vi.fn(),
}))

vi.mock('./energyPrice', () => ({
  getEnergyPrice: vi.fn(),
}))

import { OtherChain } from '@vultisig/core-chain/Chain'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'
import { getTronAccountResources } from '@vultisig/core-chain/chains/tron/resources/getTronAccountResources'
import { getEnergyPrice } from './energyPrice'
import { getTrc20TransferFee } from './fee'

const mockQueryUrl = vi.mocked(queryUrl)
const mockGetTronAccountResources = vi.mocked(getTronAccountResources)
const mockGetEnergyPrice = vi.mocked(getEnergyPrice)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ENERGY_PRICE = 280n

// feeLimit is a ceiling, not the expected cost - mirrors the +50% margin /
// 100 TRX cap applied in fee.ts so tests assert the actual returned value.
const FEE_LIMIT_MARGIN_BPS = 5_000n
const FEE_LIMIT_CAP_SUN = 100_000_000n
function withMargin(exactSun: bigint): bigint {
  const padded = exactSun + (exactSun * FEE_LIMIT_MARGIN_BPS) / 10_000n
  return padded > FEE_LIMIT_CAP_SUN ? FEE_LIMIT_CAP_SUN : padded
}

// triggerconstantcontract successful-simulation envelope. Real TronGrid
// responses nest energy_used/energy_penalty alongside a result.result flag.
function successResult(overrides: { energy_used?: number; energy_penalty?: number } = {}) {
  return { result: { result: true }, energy_used: 0, energy_penalty: 0, ...overrides }
}

function makeResources(available: number) {
  return {
    bandwidth: { available: 5000, total: 5000, used: 0 },
    energy: { available, total: available, used: 0 },
    frozenForBandwidthSun: 0n,
    frozenForEnergySun: 0n,
    unfreezingEntries: [],
  }
}

const coin = {
  address: 'TJDENsfBJs4RFETt1X1W8wMDc8M5XnJhd',
  id: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  chain: OtherChain.Tron,
}

const baseInput = {
  coin,
  amount: 1_000_000n,
  receiver: 'TJDENsfBJs4RFETt1X1W8wMDc8M5XnJhd',
}

// triggerconstantcontract response: 65k energy_used, 0 penalty (active destination)
const CONTRACT_ENERGY_USED = 65_000
const CONTRACT_ENERGY_PENALTY = 0
const TOTAL_ENERGY = BigInt(CONTRACT_ENERGY_USED + CONTRACT_ENERGY_PENALTY)

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getTrc20TransferFee', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetEnergyPrice.mockResolvedValue(ENERGY_PRICE)
    // default: no staked energy
    mockGetTronAccountResources.mockResolvedValue(makeResources(0))
  })

  it('calls /wallet/triggerconstantcontract, not /walletsolidity/...', async () => {
    mockQueryUrl.mockResolvedValue(successResult({ energy_used: 100, energy_penalty: 0 }))

    await getTrc20TransferFee(baseInput)

    const calledUrl = mockQueryUrl.mock.calls[0][0] as string
    expect(calledUrl).toMatch(/\/wallet\/triggerconstantcontract$/)
    expect(calledUrl).not.toMatch(/walletsolidity/)
  })

  it('returns (energy_used + energy_penalty) * energyPrice with feeLimit margin applied, when no staked energy', async () => {
    mockQueryUrl.mockResolvedValue(successResult({ energy_used: 30000, energy_penalty: 5000 }))
    mockGetTronAccountResources.mockResolvedValue(makeResources(0))

    const fee = await getTrc20TransferFee(baseInput)

    // (30000 + 5000) * 280 = 9_800_000 exact estimate, +50% margin, under the 100 TRX cap
    const exact = 9_800_000n
    expect(fee).toBe(withMargin(exact))
    expect(fee).toBeGreaterThan(exact)
    expect(fee).toBeLessThanOrEqual(FEE_LIMIT_CAP_SUN)
  })

  it('throws when triggerconstantcontract returns an empty/malformed response (no result field)', async () => {
    mockQueryUrl.mockResolvedValue({})

    await expect(getTrc20TransferFee(baseInput)).rejects.toThrow(/did not return a successful estimate/)
  })

  it('throws when triggerconstantcontract simulation reverts (result.result === false)', async () => {
    mockQueryUrl.mockResolvedValue({
      result: { result: false, message: 'REVERT opcode executed' },
      energy_used: 0,
      energy_penalty: 0,
    })

    await expect(getTrc20TransferFee(baseInput)).rejects.toThrow('REVERT opcode executed')
  })

  it('propagates queryUrl errors (throw-bubbling contract)', async () => {
    mockQueryUrl.mockRejectedValue(new Error('network error'))

    await expect(getTrc20TransferFee(baseInput)).rejects.toThrow('network error')
  })

  it('clamps negative energy_used / energy_penalty totals to 0n (avoids negative feeLimit broadcast reject)', async () => {
    // TronGrid edge cases can return negative values. Without clamping, the
    // negative bigint flows as `gasEstimation` into protobuf `feeLimit` via
    // `Long.fromString(gasEstimation.toString())`, encoding a negative int64
    // which TronGrid rejects at broadcast.
    mockQueryUrl.mockResolvedValue(successResult({ energy_used: -5000, energy_penalty: -1000 }))

    const fee = await getTrc20TransferFee(baseInput)

    // (-5000 + -1000) = -6000n -> clamp to 0n -> no broadcast reject
    expect(fee).toBe(0n)
  })

  it('caps feeLimit at 100 TRX for pathological estimates', async () => {
    // 1_000_000 energy * 280 sun = 280_000_000 exact; +50% margin would be
    // 420_000_000, well past the 100 TRX (100_000_000 sun) ceiling.
    mockQueryUrl.mockResolvedValue(successResult({ energy_used: 1_000_000, energy_penalty: 0 }))
    mockGetTronAccountResources.mockResolvedValue(makeResources(0))

    const fee = await getTrc20TransferFee(baseInput)

    expect(fee).toBe(FEE_LIMIT_CAP_SUN)
  })

  describe('staked energy subtraction', () => {
    beforeEach(() => {
      mockQueryUrl.mockResolvedValue(
        successResult({
          energy_used: CONTRACT_ENERGY_USED,
          energy_penalty: CONTRACT_ENERGY_PENALTY,
        })
      )
    })

    it('returns 0 when sender has more staked energy than needed (fully covered)', async () => {
      mockGetTronAccountResources.mockResolvedValue(makeResources(100_000))

      const fee = await getTrc20TransferFee(baseInput)

      expect(fee).toBe(0n)
    })

    it('returns 0 when sender has exactly the energy needed (boundary)', async () => {
      mockGetTronAccountResources.mockResolvedValue(makeResources(65_000))

      const fee = await getTrc20TransferFee(baseInput)

      expect(fee).toBe(0n)
    })

    it('returns partial burn with feeLimit margin applied when sender has less energy than needed', async () => {
      mockGetTronAccountResources.mockResolvedValue(makeResources(30_000))

      const fee = await getTrc20TransferFee(baseInput)

      // only 35_000 energy needs to be burned
      expect(fee).toBe(withMargin(35_000n * ENERGY_PRICE))
    })

    it('returns full burn with feeLimit margin applied when sender has zero staked energy', async () => {
      mockGetTronAccountResources.mockResolvedValue(makeResources(0))

      const fee = await getTrc20TransferFee(baseInput)

      expect(fee).toBe(withMargin(TOTAL_ENERGY * ENERGY_PRICE))
    })

    it('falls back to full burn with feeLimit margin applied when resources fetch throws (no crash)', async () => {
      mockGetTronAccountResources.mockRejectedValue(new Error('network error'))

      const fee = await getTrc20TransferFee(baseInput)

      // worst-case - same as before the fix, now with margin applied
      expect(fee).toBe(withMargin(TOTAL_ENERGY * ENERGY_PRICE))
    })

    it('accounts for energy_penalty in the total energy needed', async () => {
      mockQueryUrl.mockResolvedValue(
        successResult({
          energy_used: 65_000,
          energy_penalty: 10_000,
        })
      )
      // 50k available, 75k needed -> 25k burned
      mockGetTronAccountResources.mockResolvedValue(makeResources(50_000))

      const fee = await getTrc20TransferFee(baseInput)

      expect(fee).toBe(withMargin(25_000n * ENERGY_PRICE))
    })
  })
})
