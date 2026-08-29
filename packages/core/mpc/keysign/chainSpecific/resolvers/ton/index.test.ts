import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetCoinBalance, mockGetTonAccountInfo } = vi.hoisted(() => ({
  mockGetCoinBalance: vi.fn(async () => 0n),
  mockGetTonAccountInfo: vi.fn(),
}))

vi.mock('@vultisig/core-chain/chains/ton/account/getTonAccountInfo', () => ({
  getTonAccountInfo: mockGetTonAccountInfo,
}))
vi.mock('@vultisig/core-chain/chains/ton/api', () => ({
  getJettonWalletAddress: vi.fn(),
  getTonWalletState: vi.fn(async () => 'active'),
}))
vi.mock('@vultisig/core-chain/coin/balance', () => ({ getCoinBalance: mockGetCoinBalance }))
vi.mock('../../../utils/getKeysignCoin', () => ({
  getKeysignCoin: () => ({ address: 'srcAddr', id: undefined }),
}))

import { getTonChainSpecific } from './index'

type Payload = Parameters<typeof getTonChainSpecific>[0]['keysignPayload']

// Amount sits one nanoton under the balance below, which the removed heuristic read as
// a MAX send.
const payload = { toAddress: 'EQdest', toAmount: '999999999' } as unknown as Payload

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

describe('getTonChainSpecific — sendMaxAmount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetTonAccountInfo.mockResolvedValue({ account_state: { seqno: 1 } })
    mockGetCoinBalance.mockResolvedValue(1_000_000_000n)
  })

  it('records the flag the caller passed, whatever the amount looks like', async () => {
    const dustSend = { ...payload, toAmount: '1' } as unknown as Payload

    const res = await getTonChainSpecific({ keysignPayload: dustSend, walletCore: {} as never, sendMaxAmount: true })

    expect(res.sendMaxAmount).toBe(true)
  })

  // The removed heuristic flagged any `amount + fee >= balance` send as MAX, so typing
  // an amount near your balance silently relabelled an ordinary send.
  it('leaves a near-balance send unflagged when the caller did not ask for MAX', async () => {
    const res = await getTonChainSpecific({ keysignPayload: payload, walletCore: {} as never })

    expect(res.sendMaxAmount).toBe(false)
  })

  it('does not read the balance at all — nothing is inferred from it', async () => {
    await getTonChainSpecific({ keysignPayload: payload, walletCore: {} as never })

    expect(mockGetCoinBalance).not.toHaveBeenCalled()
  })
})
