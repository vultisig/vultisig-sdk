import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({ queryUrl: vi.fn() }))

import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { kaminoShareAmount, kaminoTokenAmount } from '../amount'
import { KaminoServiceError } from '../KaminoServiceError'
import { kaminoVaultRegistry } from '../registry'
import { buildKaminoDepositTransaction, buildKaminoWithdrawTransaction } from './actions'

const [steakhouse] = kaminoVaultRegistry
const owner = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

// A block body on purpose: `mockReset()` returns the mock, and a function
// returned from `beforeEach` is treated as a teardown callback.
beforeEach(() => {
  vi.mocked(queryUrl).mockReset()
})

describe('buildKaminoDepositTransaction', () => {
  it('posts the human-units token amount to the deposit endpoint', async () => {
    vi.mocked(queryUrl).mockResolvedValue({ transaction: 'dHg=' } as never)

    const transaction = await buildKaminoDepositTransaction({
      owner,
      vaultAddress: steakhouse.address,
      amount: kaminoTokenAmount(1_500_000n, 6),
    })

    expect(transaction).toBe('dHg=')
    const [url, options] = vi.mocked(queryUrl).mock.calls[0]!
    expect(url).toBe('https://api.kamino.finance/ktx/kvault/deposit')
    expect((options as { body: unknown }).body).toEqual({ wallet: owner, kvault: steakhouse.address, amount: '1.5' })
  })

  it('refuses a vault the registry does not carry, without calling out', async () => {
    await expect(
      buildKaminoDepositTransaction({ owner, vaultAddress: owner, amount: kaminoTokenAmount(1n, 6) })
    ).rejects.toBeInstanceOf(KaminoServiceError)
    expect(vi.mocked(queryUrl)).not.toHaveBeenCalled()
  })

  it('refuses an unsendable amount before it becomes a request body', async () => {
    await expect(
      buildKaminoDepositTransaction({ owner, vaultAddress: steakhouse.address, amount: kaminoTokenAmount(0n, 6) })
    ).rejects.toMatchObject({ reason: { invalidAmount: expect.stringContaining('deposit') } })
    expect(vi.mocked(queryUrl)).not.toHaveBeenCalled()
  })
})

describe('buildKaminoWithdrawTransaction', () => {
  it('posts the human-units SHARE amount to the withdraw endpoint', async () => {
    vi.mocked(queryUrl).mockResolvedValue({ transaction: 'dHg=' } as never)

    await buildKaminoWithdrawTransaction({
      owner,
      vaultAddress: steakhouse.address,
      shares: kaminoShareAmount(949_123n, 6),
    })

    const [url, options] = vi.mocked(queryUrl).mock.calls[0]!
    expect(url).toBe('https://api.kamino.finance/ktx/kvault/withdraw')
    expect((options as { body: unknown }).body).toEqual({
      wallet: owner,
      kvault: steakhouse.address,
      amount: '0.949123',
    })
  })

  it('refuses the withdraw-everything sentinel outright', async () => {
    await expect(
      buildKaminoWithdrawTransaction({
        owner,
        vaultAddress: steakhouse.address,
        shares: kaminoShareAmount(2n ** 64n - 1n, 6),
      })
    ).rejects.toMatchObject({ reason: { invalidAmount: expect.stringContaining('sentinel') } })
    expect(vi.mocked(queryUrl)).not.toHaveBeenCalled()
  })
})
