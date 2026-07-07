import { describe, expect, it, vi } from 'vitest'

const { mockGetTonAccountInfo } = vi.hoisted(() => ({ mockGetTonAccountInfo: vi.fn() }))

vi.mock('@vultisig/core-chain/chains/ton/account/getTonAccountInfo', () => ({
  getTonAccountInfo: mockGetTonAccountInfo,
}))
vi.mock('@vultisig/core-chain/chains/ton/api', () => ({
  getJettonWalletAddress: vi.fn(),
  getTonWalletState: vi.fn(async () => 'active'),
}))
vi.mock('@vultisig/core-chain/coin/balance', () => ({ getCoinBalance: vi.fn(async () => 0n) }))
vi.mock('../../../fee/resolvers/ton', () => ({ getTonFeeAmount: () => 0n }))
vi.mock('../../../utils/getKeysignCoin', () => ({
  getKeysignCoin: () => ({ address: 'srcAddr', id: undefined }),
}))
vi.mock('../../../utils/getKeysignAmount', () => ({ getKeysignAmount: () => 0n }))

import { getTonChainSpecific } from './index'

const payload = { toAddress: 'EQdest' } as unknown as Parameters<typeof getTonChainSpecific>[0]['keysignPayload']

describe('getTonChainSpecific — seqno on an uninitialized wallet', () => {
  it('does NOT throw and yields seqno 0 when account_state is absent (first send / uninitialized)', async () => {
    // getExtendedAddressInformation returns a result WITHOUT account_state for a
    // wallet that received funds but never sent — the pre-fix direct
    // `account_state.seqno` crashed here.
    mockGetTonAccountInfo.mockResolvedValueOnce({ balance: '1000000000' })
    const res = await getTonChainSpecific({ keysignPayload: payload, walletCore: {} as never })
    expect(res.sequenceNumber).toBe(0n)
  })

  it('reads the seqno from account_state for an initialized wallet', async () => {
    mockGetTonAccountInfo.mockResolvedValueOnce({ account_state: { wallet_id: 'w', seqno: 7 } })
    const res = await getTonChainSpecific({ keysignPayload: payload, walletCore: {} as never })
    expect(res.sequenceNumber).toBe(7n)
  })
})
