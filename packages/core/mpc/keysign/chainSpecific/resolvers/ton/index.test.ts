import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetJettonWalletAddress, mockGetKeysignCoin, mockGetTonAccountInfo, mockGetTonWalletState } = vi.hoisted(
  () => ({
    mockGetJettonWalletAddress: vi.fn(),
    mockGetKeysignCoin: vi.fn(),
    mockGetTonAccountInfo: vi.fn(),
    mockGetTonWalletState: vi.fn(),
  })
)

vi.mock('@vultisig/core-chain/chains/ton/account/getTonAccountInfo', () => ({
  getTonAccountInfo: mockGetTonAccountInfo,
}))
vi.mock('@vultisig/core-chain/chains/ton/api', () => ({
  getJettonWalletAddress: mockGetJettonWalletAddress,
  getTonWalletState: mockGetTonWalletState,
}))
vi.mock('@vultisig/core-chain/coin/balance', () => ({ getCoinBalance: vi.fn(async () => 0n) }))
vi.mock('../../../fee/resolvers/ton', () => ({ getTonFeeAmount: () => 0n }))
vi.mock('../../../utils/getKeysignCoin', () => ({
  getKeysignCoin: mockGetKeysignCoin,
}))
vi.mock('../../../utils/getKeysignAmount', () => ({ getKeysignAmount: () => 0n }))

import { getTonChainSpecific } from './index'

const payload = { toAddress: 'EQdest' } as unknown as Parameters<typeof getTonChainSpecific>[0]['keysignPayload']

beforeEach(() => {
  mockGetJettonWalletAddress.mockReset()
  mockGetJettonWalletAddress
    .mockResolvedValueOnce('EQsenderJettonWallet')
    .mockResolvedValueOnce('EQrecipientJettonWallet')
  mockGetKeysignCoin.mockReset()
  mockGetKeysignCoin.mockReturnValue({ address: 'srcAddr', id: undefined })
  mockGetTonAccountInfo.mockReset()
  mockGetTonWalletState.mockReset()
  mockGetTonWalletState.mockResolvedValue('active')
})

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

describe('getTonChainSpecific — jetton destination state', () => {
  beforeEach(() => {
    mockGetKeysignCoin.mockReturnValue({ address: 'srcAddr', id: 'EQjettonMaster' })
    mockGetTonAccountInfo.mockResolvedValue({ account_state: { seqno: 7 } })
  })

  it('selects the active-destination path only after an authoritative active response', async () => {
    const res = await getTonChainSpecific({ keysignPayload: payload, walletCore: {} as never })

    expect(res.isActiveDestination).toBe(true)
    expect(mockGetTonWalletState).toHaveBeenLastCalledWith('EQrecipientJettonWallet')
  })

  it('uses the conservative first-recipient path when the destination lookup fails', async () => {
    mockGetTonWalletState.mockRejectedValue(new Error('toncenter timeout'))

    const res = await getTonChainSpecific({ keysignPayload: payload, walletCore: {} as never })

    expect(res.isActiveDestination).toBe(false)
  })

  it('uses the conservative first-recipient path for a non-active destination', async () => {
    mockGetTonWalletState.mockResolvedValue('uninit')

    const res = await getTonChainSpecific({ keysignPayload: payload, walletCore: {} as never })

    expect(res.isActiveDestination).toBe(false)
  })

  it('uses the conservative first-recipient path when the recipient has no jetton wallet', async () => {
    mockGetJettonWalletAddress.mockReset()
    mockGetJettonWalletAddress.mockResolvedValueOnce('EQsenderJettonWallet').mockRejectedValueOnce(new Error('missing'))

    const res = await getTonChainSpecific({ keysignPayload: payload, walletCore: {} as never })

    expect(res.isActiveDestination).toBe(false)
    expect(mockGetTonWalletState).toHaveBeenCalledTimes(1)
  })
})
