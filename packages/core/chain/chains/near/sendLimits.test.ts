import {
  AMOUNT,
  IMPLICIT_GAS_FEE,
  NAMED_GAS_FEE,
  NAMED_RECEIVER,
  SENDER,
  setupTransport,
} from '@vultisig/core-chain/chains/near/__tests__/nearRpcTestKit'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getNearSendLimits } from './sendLimits'

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({ queryUrl: vi.fn() }))

beforeEach(() => {
  vi.mocked(queryUrl).mockReset()
})

describe('NEAR MAX through getNearSendLimits', () => {
  it('computes MAX as balance minus gas reservation minus the storage reserve', async () => {
    setupTransport({ account: { amount: AMOUNT, storage_usage: 1_000 } })

    await expect(getNearSendLimits({ address: SENDER, receiver: NAMED_RECEIVER })).resolves.toEqual({
      amount: BigInt(AMOUNT),
      gasReservation: NAMED_GAS_FEE,
      storageReserve: 10_000_000_000_000_000_000_000n,
      maxSendable: BigInt(AMOUNT) - NAMED_GAS_FEE - 10_000_000_000_000_000_000_000n,
    })
  })

  it('takes the cheaper self-send reservation and still reserves the receiver creation gas', async () => {
    setupTransport({})

    await expect(getNearSendLimits({ address: SENDER, receiver: SENDER })).resolves.toMatchObject({
      gasReservation: IMPLICIT_GAS_FEE,
      storageReserve: 0n,
      maxSendable: BigInt(AMOUNT) - IMPLICIT_GAS_FEE,
    })
  })

  it.each([
    ['zero-balance account at 770 bytes', 770, 0n],
    ['account one byte above the zero-balance limit', 771, 7_710_000_000_000_000_000_000n],
  ])('applies the NEP-448 exemption to a %s', async (_label, storageUsage, expectedReserve) => {
    setupTransport({ account: { storage_usage: storageUsage } })

    const limits = await getNearSendLimits({ address: SENDER, receiver: NAMED_RECEIVER })

    expect(limits.storageReserve).toBe(expectedReserve)
    expect(limits.maxSendable).toBe(BigInt(AMOUNT) - NAMED_GAS_FEE - expectedReserve)
  })

  it('lets locked stake back the storage requirement without becoming spendable', async () => {
    setupTransport({ account: { storage_usage: 1_000, locked: '10000000000000000000000' } })

    const limits = await getNearSendLimits({ address: SENDER, receiver: NAMED_RECEIVER })

    expect(limits.storageReserve).toBe(0n)
    expect(limits.amount).toBe(BigInt(AMOUNT))
    expect(limits.maxSendable).toBe(BigInt(AMOUNT) - NAMED_GAS_FEE)
  })
})
