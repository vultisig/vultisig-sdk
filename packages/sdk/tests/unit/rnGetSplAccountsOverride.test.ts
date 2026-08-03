import { describe, expect, it, vi } from 'vitest'

const getParsedTokenAccountsByOwnerMock = vi.hoisted(() => vi.fn())

vi.mock('@vultisig/core-chain/chains/solana/client', () => ({
  getSolanaClient: () => ({
    getParsedTokenAccountsByOwner: getParsedTokenAccountsByOwnerMock,
  }),
}))
vi.mock('@vultisig/core-chain/chains/solana/config', () => ({
  splTokenProgramId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  token2022ProgramId: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
}))

import { getSplAccounts } from '@/platforms/react-native/overrides/getSplAccounts'

const OWNER = 'So11111111111111111111111111111111111111112'
const acc = (mint: string) => ({ pubkey: {}, account: { data: { parsed: { info: { mint } } } } })

// Mirrors the core getSplAccounts test — the RN/Hermes override must stay in
// lockstep so one token-program failure doesn't hide the other's holdings.
describe('RN getSplAccounts override — one token-program failure must not hide the other', () => {
  it('merges accounts when both program queries succeed', async () => {
    getParsedTokenAccountsByOwnerMock.mockReset()
    getParsedTokenAccountsByOwnerMock
      .mockResolvedValueOnce({ context: { slot: 1 }, value: [acc('MINT_SPL')] })
      .mockResolvedValueOnce({ context: { slot: 1 }, value: [acc('MINT_2022')] })
    const out = await getSplAccounts(OWNER)
    expect(out.map((a: any) => a.account.data.parsed.info.mint)).toEqual(['MINT_SPL', 'MINT_2022'])
  })

  it("returns the surviving program's accounts when the other query fails", async () => {
    getParsedTokenAccountsByOwnerMock.mockReset()
    getParsedTokenAccountsByOwnerMock
      .mockResolvedValueOnce({ context: { slot: 1 }, value: [acc('MINT_SPL')] })
      .mockRejectedValueOnce(new Error('token-2022 RPC 520'))
    const out = await getSplAccounts(OWNER)
    expect(out.map((a: any) => a.account.data.parsed.info.mint)).toEqual(['MINT_SPL'])
  })

  it('throws only when BOTH program queries fail', async () => {
    getParsedTokenAccountsByOwnerMock.mockReset()
    getParsedTokenAccountsByOwnerMock
      .mockRejectedValueOnce(new Error('spl RPC 520'))
      .mockRejectedValueOnce(new Error('token-2022 RPC 520'))
    await expect(getSplAccounts(OWNER)).rejects.toThrow(/520/)
  })
})
