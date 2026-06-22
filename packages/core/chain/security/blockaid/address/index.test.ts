import { describe, expect, it, vi } from 'vitest'

// Mock the query module before importing the module under test.
vi.mock('../core/query', () => ({
  queryBlockaid: vi.fn(),
}))

// Also mock core-config so tests don't depend on the actual domain.
vi.mock('@vultisig/core-config', () => ({
  productRootDomain: 'vultisig.com',
}))

import { queryBlockaid } from '../core/query'
import { scanAddressWithBlockaid } from './index'

const mockQuery = vi.mocked(queryBlockaid)

describe('scanAddressWithBlockaid', () => {
  it('calls queryBlockaid with the correct route and payload', async () => {
    mockQuery.mockResolvedValueOnce({ result_type: 'Benign', features: [] })
    await scanAddressWithBlockaid('0x123', 'ethereum')
    expect(mockQuery).toHaveBeenCalledWith('/evm/address/scan', {
      address: '0x123',
      chain: 'ethereum',
      metadata: { domain: 'vultisig.com' },
    })
  })

  it('maps a Malicious response correctly, preserving features array', async () => {
    mockQuery.mockResolvedValueOnce({
      result_type: 'Malicious',
      features: ['mixer', 'drainer'],
    })
    const result = await scanAddressWithBlockaid('0xabc', 'ethereum')
    expect(result).toEqual({ resultType: 'Malicious', features: ['mixer', 'drainer'] })
  })

  it('maps a Benign response correctly', async () => {
    mockQuery.mockResolvedValueOnce({ result_type: 'Benign', features: [] })
    const result = await scanAddressWithBlockaid('0xdef', 'polygon')
    expect(result).toEqual({ resultType: 'Benign', features: [] })
  })

  it('maps a Warning response correctly', async () => {
    mockQuery.mockResolvedValueOnce({
      result_type: 'Warning',
      features: ['new_contract'],
    })
    const result = await scanAddressWithBlockaid('0xfff', 'base')
    expect(result).toEqual({ resultType: 'Warning', features: ['new_contract'] })
  })

  it('defaults features to empty array when proxy omits the field', async () => {
    mockQuery.mockResolvedValueOnce({ result_type: 'Benign' })
    const result = await scanAddressWithBlockaid('0x111', 'ethereum')
    expect(result.features).toEqual([])
  })
})
