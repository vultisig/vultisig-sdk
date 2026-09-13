import { describe, expect, it, vi } from 'vitest'

const getParsedTokenAccountsByOwnerMock = vi.hoisted(() => vi.fn())

vi.mock('@vultisig/core-chain/chains/solana/client', () => ({
  getSolanaClient: () => ({
    getParsedTokenAccountsByOwner: getParsedTokenAccountsByOwnerMock,
  }),
}))
vi.mock('@vultisig/core-chain/chains/solana/config', () => ({
  token2022ProgramId: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
}))

import { getSplAssociatedAccount } from '@vultisig/core-chain/chains/solana/spl/getSplAssociatedAccount'

const OWNER = 'So11111111111111111111111111111111111111112'
const MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

// sdk#1728: proves the resolver `buildSplTransfer` callers are meant to use
// for its safety-critical `isToken2022` flag actually derives it from the
// SAME signal (the returned account's owner program) the SDK already uses
// internally in tools/balance/solana.ts.
describe('getSplAssociatedAccount', () => {
  it('reports isToken2022=true for an account owned by the Token-2022 program', async () => {
    getParsedTokenAccountsByOwnerMock.mockReset().mockResolvedValueOnce({
      value: [
        {
          pubkey: { toBase58: () => 'ATA_ADDRESS' },
          account: { owner: { toBase58: () => 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' } },
        },
      ],
    })

    const result = await getSplAssociatedAccount({ account: OWNER, token: MINT })

    expect(result).toEqual({ address: 'ATA_ADDRESS', isToken2022: true })
  })

  it('reports isToken2022=false for a legacy SPL Token-owned account', async () => {
    getParsedTokenAccountsByOwnerMock.mockReset().mockResolvedValueOnce({
      value: [
        {
          pubkey: { toBase58: () => 'ATA_ADDRESS' },
          account: { owner: { toBase58: () => 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' } },
        },
      ],
    })

    const result = await getSplAssociatedAccount({ account: OWNER, token: MINT })

    expect(result).toEqual({ address: 'ATA_ADDRESS', isToken2022: false })
  })

  it('throws when the owner has no associated token account for the mint', async () => {
    getParsedTokenAccountsByOwnerMock.mockReset().mockResolvedValueOnce({ value: [] })

    await expect(getSplAssociatedAccount({ account: OWNER, token: MINT })).rejects.toThrow(
      /no associated token account/i
    )
  })
})
