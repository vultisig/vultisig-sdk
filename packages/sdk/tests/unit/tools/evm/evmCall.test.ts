import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the EVM client before importing the module under test
const mockCall = vi.fn()
vi.mock('@vultisig/core-chain/chains/evm/client', () => ({
  getEvmClient: () => ({ call: mockCall }),
}))

import { evmCall } from '@/tools/evm/evmCall'

describe('evmCall', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls the contract and returns hex data', async () => {
    mockCall.mockResolvedValue({
      data: '0x0000000000000000000000000000000000000000000000000000000005f5e100',
    })

    const result = await evmCall('Ethereum', {
      to: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      data: '0x18160ddd', // totalSupply()
    })

    expect(result).toBe('0x0000000000000000000000000000000000000000000000000000000005f5e100')
    expect(mockCall).toHaveBeenCalledWith({
      to: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      data: '0x18160ddd',
      account: undefined,
    })
  })

  it('passes from address when provided', async () => {
    mockCall.mockResolvedValue({ data: '0x01' })

    await evmCall('Ethereum', {
      to: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      data: '0x18160ddd',
      from: '0x000000000000000000000000000000000000dEaD',
    })

    expect(mockCall).toHaveBeenCalledWith(
      expect.objectContaining({
        account: '0x000000000000000000000000000000000000dEaD',
      })
    )
  })

  it('throws when call returns no data', async () => {
    mockCall.mockResolvedValue({ data: undefined })

    await expect(
      evmCall('Ethereum', {
        to: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        data: '0x18160ddd',
      })
    ).rejects.toThrow('evm_call returned no data')
  })
})
