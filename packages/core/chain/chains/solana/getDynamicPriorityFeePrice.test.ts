import { afterEach, describe, expect, it, vi } from 'vitest'

// Mock the Solana client BEFORE importing the module under test, so the
// dynamic getRecentPrioritizationFees call is intercepted at every test.
const getRecentPrioritizationFeesMock = vi.fn()

vi.mock('./client', () => ({
  getSolanaClient: () => ({
    getRecentPrioritizationFees: getRecentPrioritizationFeesMock,
  }),
}))

import { _MIN_SAMPLE_SIZE_FOR_TEST, getDynamicPriorityFeePrice } from './getDynamicPriorityFeePrice'
import { solanaConfig } from './solanaConfig'

const FLOOR = solanaConfig.priorityFeePrice
const MIN = _MIN_SAMPLE_SIZE_FOR_TEST

const fees = (...values: number[]) => values.map(v => ({ slot: 0, prioritizationFee: v }))

afterEach(() => {
  getRecentPrioritizationFeesMock.mockReset()
})

describe('getDynamicPriorityFeePrice', () => {
  it('selects the actual P75 of the SORTED fee distribution (not slot-ordered position)', async () => {
    // Unsorted input: [10, 50, 30, 90, 20]
    // Sorted: [10, 20, 30, 50, 90]
    // index = floor(5 * 0.75) = 3 -> sorted[3] = 50
    // Math.max(50, FLOOR=1_000_000) = 1_000_000 (floor wins because 50 << floor)
    // To actually exercise the percentile pick (not the floor), use values above floor.
    getRecentPrioritizationFeesMock.mockResolvedValue(fees(2_000_000, 5_000_000, 3_000_000, 9_000_000, 4_000_000))
    // Sorted: [2M, 3M, 4M, 5M, 9M] -> index 3 -> 5M
    expect(await getDynamicPriorityFeePrice()).toBe(5_000_000)
  })

  it('returns floor when sample below MIN_SAMPLE_SIZE (sparse-window guard)', async () => {
    // 1 entry (below MIN=5): the percentile would pick that single
    // value, which - if it was a 50_000_000 LP-add slot - would
    // overpay massively. Sparse-window guard returns floor.
    getRecentPrioritizationFeesMock.mockResolvedValue(fees(50_000_000))
    expect(await getDynamicPriorityFeePrice()).toBe(FLOOR)
  })

  it('returns floor when computed P75 falls below floor', async () => {
    // 5 entries, sorted, P75 picks an above-floor index but the
    // value is below floor anyway. Math.max enforces the cross-
    // platform minimum.
    getRecentPrioritizationFeesMock.mockResolvedValue(fees(10, 20, 30, 40, 50))
    // Sorted: [10,20,30,40,50] -> index 3 -> 40 -> max(40, FLOOR) = FLOOR
    expect(await getDynamicPriorityFeePrice()).toBe(FLOOR)
  })

  it('returns floor on empty input (no recent prioritization fees)', async () => {
    getRecentPrioritizationFeesMock.mockResolvedValue([])
    expect(await getDynamicPriorityFeePrice()).toBe(FLOOR)
  })

  it('returns floor when ALL fees are zero (filtered out, then sparse)', async () => {
    getRecentPrioritizationFeesMock.mockResolvedValue(fees(0, 0, 0, 0, 0, 0, 0))
    // After .filter(fee => fee > 0) we get [], length 0 < MIN.
    expect(await getDynamicPriorityFeePrice()).toBe(FLOOR)
  })

  it('passes lockedWritableAccounts when writableAccounts provided', async () => {
    getRecentPrioritizationFeesMock.mockResolvedValue([])
    // Pass an empty array of PublicKey-shaped objects via type assertion.
    // We don't need a real PublicKey for this assertion; the helper
    // only forwards the array verbatim.
    const fakeAccount = { _bn: 'fake' } as unknown as never
    await getDynamicPriorityFeePrice([fakeAccount])
    expect(getRecentPrioritizationFeesMock).toHaveBeenCalledWith({
      lockedWritableAccounts: [fakeAccount],
    })
  })

  it('omits lockedWritableAccounts when writableAccounts is empty', async () => {
    getRecentPrioritizationFeesMock.mockResolvedValue([])
    await getDynamicPriorityFeePrice()
    expect(getRecentPrioritizationFeesMock).toHaveBeenCalledWith(undefined)
  })

  it(`MIN_SAMPLE_SIZE is exposed for test pin (currently ${MIN})`, () => {
    // Pin the threshold so a future regression that drops the guard
    // trips loud. Round-1 paaao PR at HEAD shipped with no guard;
    // this test would have caught that.
    expect(_MIN_SAMPLE_SIZE_FOR_TEST).toBe(5)
  })
})
