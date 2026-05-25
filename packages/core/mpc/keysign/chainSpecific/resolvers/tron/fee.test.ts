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
})
