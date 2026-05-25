import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: vi.fn(),
}))

import { OtherChain } from '@vultisig/core-chain/Chain'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'
import { getTrc20TransferFee } from './fee'

const mockQueryUrl = vi.mocked(queryUrl)

const coin = {
  address: 'TJDENsfBJs4RFETt1X1W8wMDc8M5XnJhd',
  id: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  chain: OtherChain.Tron,
}

describe('getTrc20TransferFee', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls /wallet/triggerconstantcontract, not /walletsolidity/...', async () => {
    mockQueryUrl.mockResolvedValue({ energy_used: 100, energy_penalty: 0 })

    await getTrc20TransferFee({ coin, amount: 1_000_000n, receiver: 'TJDENsfBJs4RFETt1X1W8wMDc8M5XnJhd' })

    const calledUrl = mockQueryUrl.mock.calls[0][0] as string
    expect(calledUrl).toMatch(/\/wallet\/triggerconstantcontract$/)
    expect(calledUrl).not.toMatch(/walletsolidity/)
  })

  it('returns (energy_used + energy_penalty) * 280n as fee', async () => {
    mockQueryUrl.mockResolvedValue({ energy_used: 30000, energy_penalty: 5000 })

    const fee = await getTrc20TransferFee({ coin, amount: 1_000_000n, receiver: 'TJDENsfBJs4RFETt1X1W8wMDc8M5XnJhd' })

    // (30000 + 5000) * 280 = 9_800_000
    expect(fee).toBe(9_800_000n)
  })

  it('defaults missing energy fields to 0', async () => {
    mockQueryUrl.mockResolvedValue({})

    const fee = await getTrc20TransferFee({ coin, amount: 1_000_000n, receiver: 'TJDENsfBJs4RFETt1X1W8wMDc8M5XnJhd' })

    expect(fee).toBe(0n)
  })

  it('propagates queryUrl errors (throw-bubbling contract)', async () => {
    mockQueryUrl.mockRejectedValue(new Error('network error'))

    await expect(
      getTrc20TransferFee({ coin, amount: 1_000_000n, receiver: 'TJDENsfBJs4RFETt1X1W8wMDc8M5XnJhd' })
    ).rejects.toThrow('network error')
  })

  it('clamps negative energy_used / energy_penalty totals to 0n (avoids negative feeLimit broadcast reject)', async () => {
    // TronGrid edge cases can return negative values. Without clamping, the
    // negative bigint flows as `gasEstimation` into protobuf `feeLimit` via
    // `Long.fromString(gasEstimation.toString())`, encoding a negative int64
    // which TronGrid rejects at broadcast. Send-service path has a similar
    // guard at sdk/src/chains/tron/tx.ts:391; this mirrors it for the MPC
    // keysign path.
    mockQueryUrl.mockResolvedValue({ energy_used: -5000, energy_penalty: -1000 })

    const fee = await getTrc20TransferFee({ coin, amount: 1_000_000n, receiver: 'TJDENsfBJs4RFETt1X1W8wMDc8M5XnJhd' })

    // (-5000 + -1000) = -6000n -> clamp to 0n -> no broadcast reject
    expect(fee).toBe(0n)
  })
})
