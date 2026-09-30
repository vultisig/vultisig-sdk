import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { PublicKey } from '@solana/web3.js'
import { getSplAssociatedAccount as coreResolver } from '@vultisig/core-chain/chains/solana/spl/getSplAssociatedAccount'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getSplAssociatedAccount as rnResolver } from '@/platforms/react-native/overrides/getSplAssociatedAccount'
import { buildSplTransfer } from '@/tools/prep/splTransfer'

const query = vi.hoisted(() => vi.fn())
vi.mock('@vultisig/core-chain/chains/solana/client', () => ({
  getSolanaClient: () => ({ getParsedTokenAccountsByOwner: query }),
}))

const account = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'
const token = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const recipient = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
const candidate = (pubkey: PublicKey, program: PublicKey) => ({ pubkey, account: { owner: program } })

// The two implementations share the same behavioral contract, including ATA
// selection. Use spl-token's independent derivation as the expected address.
describe.each([
  ['core', coreResolver],
  ['React Native', rnResolver],
] as const)('%s associated-account resolver', (_platform, resolve) => {
  beforeEach(() => {
    query.mockReset()
  })

  describe.each([
    ['legacy SPL', TOKEN_PROGRAM_ID, false],
    ['Token-2022', TOKEN_2022_PROGRAM_ID, true],
  ] as const)('%s', (_program, program, isToken2022) => {
    const ata = getAssociatedTokenAddressSync(new PublicKey(token), new PublicKey(account), false, program)
    const unrelated = candidate(new PublicKey(recipient), program)

    it.each(['first', 'last'] as const)('finds the ATA when it is %s in the RPC response', async order => {
      const associated = candidate(ata, program)
      query.mockResolvedValue({ value: order === 'first' ? [associated, unrelated] : [unrelated, associated] })
      const result = await resolve({ account, token })
      expect(result).toEqual({ address: ata.toBase58(), isToken2022 })
      expect(query).toHaveBeenCalledWith(new PublicKey(account), { mint: new PublicKey(token) })

      const transfer = buildSplTransfer({
        mint: token,
        from: account,
        to: recipient,
        amount: 1n,
        decimals: 6,
        isToken2022: result.isToken2022,
      })
      expect(transfer.fromTokenAccount).toBe(result.address)
      expect(transfer.programId).toBe(program.toBase58())
      expect(transfer.instruction.programId).toBe(program.toBase58())
    })

    it('rejects non-associated holdings instead of choosing an arbitrary source', async () => {
      query.mockResolvedValue({ value: [unrelated] })
      await expect(resolve({ account, token })).rejects.toThrow('No associated token account found')
    })

    it('rejects an ATA paired with the wrong token program', async () => {
      const otherProgram = isToken2022 ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID
      query.mockResolvedValue({ value: [candidate(ata, otherProgram)] })
      await expect(resolve({ account, token })).rejects.toThrow('No associated token account found')
    })
  })

  it('preserves the missing-account error', async () => {
    query.mockResolvedValue({ value: [] })
    await expect(resolve({ account, token })).rejects.toThrow('No associated token account found')
  })

  it('does not treat an unsupported program as legacy SPL', async () => {
    const unsupported = new PublicKey(recipient)
    const address = getAssociatedTokenAddressSync(new PublicKey(token), new PublicKey(account), false, unsupported)
    query.mockResolvedValue({ value: [candidate(address, unsupported)] })
    await expect(resolve({ account, token })).rejects.toThrow('No associated token account found')
  })

  it('propagates RPC errors without defaulting to the legacy program', async () => {
    query.mockRejectedValue(new Error('RPC unavailable'))
    await expect(resolve({ account, token })).rejects.toThrow('RPC unavailable')
  })

  it('rejects invalid addresses before querying RPC', async () => {
    await expect(resolve({ account: 'invalid', token })).rejects.toThrow()
    await expect(resolve({ account, token: 'invalid' })).rejects.toThrow()
    expect(query).not.toHaveBeenCalled()
  })
})
