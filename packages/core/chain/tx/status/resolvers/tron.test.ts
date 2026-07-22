import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  queryUrl: vi.fn(),
}))

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: mocks.queryUrl,
}))

import { OtherChain } from '../../../Chain'
import { getTronTxStatus } from './tron'

describe('getTronTxStatus', () => {
  const hash = 'abc123'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns pending when tx has no blockNumber (not yet mined)', async () => {
    mocks.queryUrl.mockResolvedValue({ id: hash })

    const result = await getTronTxStatus({ chain: OtherChain.Tron, hash })
    expect(result).toEqual({ status: 'pending', isKnown: true })
  })

  it('returns pending when blockNumber is 0', async () => {
    mocks.queryUrl.mockResolvedValue({ id: hash, blockNumber: 0 })

    const result = await getTronTxStatus({ chain: OtherChain.Tron, hash })
    expect(result).toEqual({ status: 'pending', isKnown: true })
  })

  it('returns pending when receipt is absent (mined but receipt object missing)', async () => {
    mocks.queryUrl.mockResolvedValue({ id: hash, blockNumber: 12345 })

    const result = await getTronTxStatus({ chain: OtherChain.Tron, hash })
    expect(result).toEqual({ status: 'pending', isKnown: true })
  })

  it('returns success when receipt is present but result is absent', async () => {
    mocks.queryUrl.mockResolvedValue({ id: hash, blockNumber: 12345, receipt: {}, fee: 1000000 })

    const result = await getTronTxStatus({ chain: OtherChain.Tron, hash })
    expect(result.status).toBe('success')
    expect(result.receipt).toMatchObject({ feeAmount: BigInt(1000000) })
  })

  it('returns error for FAILED', async () => {
    mocks.queryUrl.mockResolvedValue({ id: hash, blockNumber: 12345, receipt: { result: 'FAILED' } })

    const result = await getTronTxStatus({ chain: OtherChain.Tron, hash })
    expect(result.status).toBe('error')
  })

  it('returns error for OUT_OF_ENERGY (not only FAILED)', async () => {
    mocks.queryUrl.mockResolvedValue({ id: hash, blockNumber: 12345, receipt: { result: 'OUT_OF_ENERGY' } })

    const result = await getTronTxStatus({ chain: OtherChain.Tron, hash })
    expect(result.status).toBe('error')
  })

  it('returns error for REVERT', async () => {
    mocks.queryUrl.mockResolvedValue({ id: hash, blockNumber: 12345, receipt: { result: 'REVERT' } })

    const result = await getTronTxStatus({ chain: OtherChain.Tron, hash })
    expect(result.status).toBe('error')
  })

  it('returns error for OUT_OF_TIME', async () => {
    mocks.queryUrl.mockResolvedValue({ id: hash, blockNumber: 12345, receipt: { result: 'OUT_OF_TIME' } })

    const result = await getTronTxStatus({ chain: OtherChain.Tron, hash })
    expect(result.status).toBe('error')
  })

  it('returns error for BANDWIDTH_ERROR', async () => {
    mocks.queryUrl.mockResolvedValue({ id: hash, blockNumber: 12345, receipt: { result: 'BANDWIDTH_ERROR' } })

    const result = await getTronTxStatus({ chain: OtherChain.Tron, hash })
    expect(result.status).toBe('error')
  })

  it('returns error for ACCOUNT_FREEZED', async () => {
    mocks.queryUrl.mockResolvedValue({ id: hash, blockNumber: 12345, receipt: { result: 'ACCOUNT_FREEZED' } })

    const result = await getTronTxStatus({ chain: OtherChain.Tron, hash })
    expect(result.status).toBe('error')
  })

  // sdk#1505 should-fix (S1): completes the documented core/Tron.proto contractResult enum
  // (every non-DEFAULT, non-SUCCESS member) so every KNOWN failure resolves promptly to 'error'
  // instead of falling to the allowlist's 'pending' branch and waiting out the poll timeout.
  // Names are the exact protobuf enum spellings (PRECOMPILED_CONTRACT, not *_ERROR) and stay in
  // parity with the app's TRON_TERMINAL_FAILURE_RESULTS. 'UNKNOWN' here is the enum member
  // (value 14) — distinct from a genuinely unrecognized code, which still buckets pending below.
  it.each([
    'TRANSFER_FAILED',
    'BAD_JUMP_DESTINATION',
    'OUT_OF_MEMORY',
    'STACK_OVERFLOW',
    'STACK_TOO_SMALL',
    'STACK_TOO_LARGE',
    'ILLEGAL_OPERATION',
    'PRECOMPILED_CONTRACT',
    'JVM_STACK_OVER_FLOW',
    'UNKNOWN',
    'INVALID_CODE',
  ])('returns error for %s (completed contractResult allowlist)', async result => {
    mocks.queryUrl.mockResolvedValue({ id: hash, blockNumber: 12345, receipt: { result } })

    const status = await getTronTxStatus({ chain: OtherChain.Tron, hash })
    expect(status.status).toBe('error')
  })

  // NeO's live mainnet canary: real USDT TRC20 transfer emits receipt.result='SUCCESS'.
  // protobuf3 serializes non-default contractResult enum values by name — value=1 (SUCCESS) is
  // non-default so it appears as "SUCCESS" in the JSON response. Must NOT be treated as error.
  it('returns success for receipt.result=SUCCESS (TRC20 transfer — NeO live tx 1540b1b3)', async () => {
    mocks.queryUrl.mockResolvedValue({ id: hash, blockNumber: 12345, receipt: { result: 'SUCCESS' } })

    const result = await getTronTxStatus({ chain: OtherChain.Tron, hash })
    expect(result.status).toBe('success')
  })

  // Inverted from a deny-list to an allowlist: an unrecognized receipt.result must never be
  // narrated as success just because it isn't on the known-failure list. SUCCESS/absent still
  // resolve to success (see tests above); a truly unknown code now falls to pending instead.
  it('returns pending (never success) for an unrecognized receipt.result value', async () => {
    mocks.queryUrl.mockResolvedValue({ id: hash, blockNumber: 12345, receipt: { result: 'UNKNOWN_FUTURE_CODE' } })

    const result = await getTronTxStatus({ chain: OtherChain.Tron, hash })
    expect(result).toEqual({ status: 'pending', isKnown: true })
  })

  it('returns error when top-level result is FAILED and receipt is absent (iOS parity)', async () => {
    mocks.queryUrl.mockResolvedValue({ id: hash, blockNumber: 12345, result: 'FAILED' })

    const result = await getTronTxStatus({ chain: OtherChain.Tron, hash })
    expect(result.status).toBe('error')
  })

  // Tron RPC never emits result:'SUCCESS' at the top level — the field is absent on success.
  // This test asserts the invariant: an unexpected non-FAILED top-level result falls through
  // to receipt-based resolution and does NOT become a false positive.
  it('does not misclassify an unknown top-level result as success (falls through to receipt path)', async () => {
    // receipt is absent → still pending, not success
    mocks.queryUrl.mockResolvedValue({ id: hash, blockNumber: 12345, result: 'SUCCESS' })

    const result = await getTronTxStatus({ chain: OtherChain.Tron, hash })
    expect(result).toEqual({ status: 'pending', isKnown: true }) // no receipt → pending, not success
  })

  it('returns isKnown:false on network error', async () => {
    mocks.queryUrl.mockRejectedValue(new Error('network failure'))

    const result = await getTronTxStatus({ chain: OtherChain.Tron, hash })
    expect(result).toEqual({ status: 'pending', isKnown: false })
  })

  it('returns not_found when Tron RPC returns an empty unknown-hash payload', async () => {
    mocks.queryUrl.mockResolvedValue({})

    const result = await getTronTxStatus({ chain: OtherChain.Tron, hash })
    expect(result).toEqual({ status: 'not_found', isKnown: false })
  })
})
