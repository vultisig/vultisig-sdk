import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  buildSendKeysignPayload: vi.fn(),
  getFeeAmount: vi.fn(),
}))

vi.mock('./build', () => ({ buildSendKeysignPayload: mocks.buildSendKeysignPayload }))
vi.mock('@vultisig/core-mpc/keysign/fee', () => ({ getFeeAmount: mocks.getFeeAmount }))

import { Chain } from '@vultisig/core-chain/Chain'

import { getSendFeeEstimate } from './getSendFeeEstimate'

const usdt = {
  chain: Chain.Ton,
  id: 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs',
  address: 'UQsender',
  ticker: 'USDT',
  decimals: 6,
}
const ton = { chain: Chain.Ton, address: 'UQsender', ticker: 'TON', decimals: 9 }

const baseInput = {
  receiver: 'UQreceiver',
  amount: 4_244_178n,
  vaultId: 'vault',
  localPartyId: 'party',
  publicKey: {} as never,
  libType: 'DKLS' as const,
  walletCore: {} as never,
  sendMaxAmount: true,
}

describe('getSendFeeEstimate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.buildSendKeysignPayload.mockResolvedValue({ coin: { chain: Chain.Ton } })
    mocks.getFeeAmount.mockResolvedValue(150_000n)
  })

  // A full-balance quote can never leave room for the relay's commission, and the
  // commission does not depend on the amount, so the fee is quoted for the smallest transfer.
  it('quotes a gasless TON jetton fee for the smallest transfer, not the full balance', async () => {
    await expect(getSendFeeEstimate({ ...baseInput, coin: usdt, tonGasless: true })).resolves.toBe(150_000n)

    expect(mocks.buildSendKeysignPayload).toHaveBeenCalledWith(
      expect.objectContaining({ coin: usdt, amount: 1n, sendMaxAmount: false, tonGasless: true })
    )
  })

  it('builds a direct jetton send with the amount it was given', async () => {
    await getSendFeeEstimate({ ...baseInput, coin: usdt })

    expect(mocks.buildSendKeysignPayload).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 4_244_178n, sendMaxAmount: true })
    )
  })

  it('leaves a native TON send alone even if the flag is set', async () => {
    await getSendFeeEstimate({ ...baseInput, coin: ton, tonGasless: true })

    expect(mocks.buildSendKeysignPayload).toHaveBeenCalledWith(expect.objectContaining({ amount: 4_244_178n }))
  })
})
