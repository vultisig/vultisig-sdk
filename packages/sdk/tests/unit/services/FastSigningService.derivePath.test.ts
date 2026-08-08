import { describe, expect, it, vi } from 'vitest'

import { FastSigningService } from '../../../src/services/FastSigningService'

describe('FastSigningService explicit derivation path', () => {
  it('passes the requested child path to server coordination', async () => {
    const coordinateFastSigning = vi.fn().mockResolvedValue({
      signature: '3044',
      format: 'ECDSA',
    })
    const service = new FastSigningService(
      { coordinateFastSigning } as any,
      { getWalletCore: vi.fn().mockResolvedValue({}) } as any
    )
    const vault = {
      signers: ['device', 'Server-fast'],
      keyShares: { ecdsa: 'share' },
    }

    await service.signBytesWithServer(
      vault as any,
      {
        messageHashes: ['ab'.repeat(32)],
        chain: 'Bitcoin' as any,
        derivePath: "m/84'/1'/0'/0/7",
      },
      'password'
    )

    expect(coordinateFastSigning).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          chain: 'Bitcoin',
          derivePath: "m/84'/1'/0'/0/7",
        }),
      })
    )
  })
})

