import { describe, expect, it, vi } from 'vitest'

const getParsedTokenAccountsByOwnerMock = vi.hoisted(() => vi.fn())

vi.mock('../client', () => ({
  getSolanaClient: () => ({
    getParsedTokenAccountsByOwner: getParsedTokenAccountsByOwnerMock,
  }),
}))

// The real config exports valid base58 program ids; keep them so `new
// PublicKey(programId)` doesn't throw.
import { getSplAccounts } from './getSplAccounts'

const OWNER = 'So11111111111111111111111111111111111111112'
const acc = (mint: string) => ({ pubkey: {}, account: { data: { parsed: { info: { mint } } } } })

describe('getSplAccounts — one token-program failure must not hide the other', () => {
  it('merges accounts when both program queries succeed', async () => {
    getParsedTokenAccountsByOwnerMock
      .mockResolvedValueOnce({ context: { slot: 1 }, value: [acc('MINT_SPL')] })
      .mockResolvedValueOnce({ context: { slot: 1 }, value: [acc('MINT_2022')] })

    const out = await getSplAccounts(OWNER)
    expect(out.map((a: any) => a.account.data.parsed.info.mint)).toEqual(['MINT_SPL', 'MINT_2022'])
  })

  it("returns the surviving program's accounts when the other query fails", async () => {
    getParsedTokenAccountsByOwnerMock
      .mockResolvedValueOnce({ context: { slot: 1 }, value: [acc('MINT_SPL')] })
      .mockRejectedValueOnce(new Error('token-2022 RPC 520'))

    const out = await getSplAccounts(OWNER)
    // Previously Promise.all would have thrown and returned nothing.
    expect(out.map((a: any) => a.account.data.parsed.info.mint)).toEqual(['MINT_SPL'])
  })

  it('throws only when BOTH program queries fail', async () => {
    getParsedTokenAccountsByOwnerMock
      .mockRejectedValueOnce(new Error('spl RPC 520'))
      .mockRejectedValueOnce(new Error('token-2022 RPC 520'))

    await expect(getSplAccounts(OWNER)).rejects.toThrow(/520/)
  })
})
