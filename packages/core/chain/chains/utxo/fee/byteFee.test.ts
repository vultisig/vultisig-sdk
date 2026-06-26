import { UtxoChain } from '@vultisig/core-chain/Chain'
import { getUtxoStats } from '@vultisig/core-chain/chains/utxo/client/getUtxoStats'
import { describe, expect, it, vi } from 'vitest'

import { getUtxoByteFee } from './byteFee'

vi.mock('@vultisig/core-chain/chains/utxo/client/getUtxoStats', () => ({
  getUtxoStats: vi.fn(),
}))

const mockGetUtxoStats = vi.mocked(getUtxoStats)

describe('getUtxoByteFee', () => {
  it('uses the app-aligned 25% Dogecoin multiplier', async () => {
    mockGetUtxoStats.mockResolvedValueOnce({
      data: { suggested_transaction_fee_per_byte_sat: 500_000 },
    })

    await expect(getUtxoByteFee(UtxoChain.Dogecoin)).resolves.toBe(125_000n)
  })
})
