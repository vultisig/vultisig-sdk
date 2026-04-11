import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetEnsAddress = vi.fn()

vi.mock('@vultisig/core-chain/chains/evm/client', () => ({
  getEvmClient: () => ({ getEnsAddress: mockGetEnsAddress }),
}))

vi.mock('viem/ens', () => ({
  normalize: (name: string) => name,
}))

import { resolveEns } from '@/tools/evm/resolveEns'

describe('resolveEns', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves a known ENS name to an address', async () => {
    mockGetEnsAddress.mockResolvedValue('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')

    const result = await resolveEns('vitalik.eth')

    expect(result).toBe('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')
    expect(mockGetEnsAddress).toHaveBeenCalledWith({ name: 'vitalik.eth' })
  })

  it('returns null for non-existent ENS names', async () => {
    mockGetEnsAddress.mockResolvedValue(null)

    const result = await resolveEns('thisdoesnotexist12345.eth')

    expect(result).toBeNull()
  })
})
