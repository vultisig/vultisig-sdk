import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetTonAccountInfo, mockGetTonWalletState } = vi.hoisted(() => ({
  mockGetTonAccountInfo: vi.fn(),
  mockGetTonWalletState: vi.fn(),
}))

vi.mock('@vultisig/core-chain/chains/ton/account/getTonAccountInfo', () => ({
  getTonAccountInfo: mockGetTonAccountInfo,
}))
vi.mock('@vultisig/core-chain/chains/ton/api', () => ({
  getJettonWalletAddress: vi.fn(),
  getTonWalletState: mockGetTonWalletState,
}))
vi.mock('@vultisig/core-chain/coin/balance', () => ({ getCoinBalance: vi.fn(async () => 0n) }))
vi.mock('../../../fee/resolvers/ton', () => ({ getTonFeeAmount: () => 0n }))
vi.mock('../../../utils/getKeysignCoin', () => ({
  getKeysignCoin: () => ({ address: 'srcAddr', id: undefined }),
}))
vi.mock('../../../utils/getKeysignAmount', () => ({ getKeysignAmount: () => 0n }))

import { getTonChainSpecific } from './index'

type Payload = Parameters<typeof getTonChainSpecific>[0]['keysignPayload']

const bounceableAddress = 'EQDmLe6ticcY_uLZsfurdYONshNuCn8IS81KcJ8p6M6ISJrE'
const nonBounceableAddress = 'UQDmLe6ticcY_uLZsfurdYONshNuCn8IS81KcJ8p6M6ISMcB'
const rawAddress = '0:e62deead89c718fee2d9b1fbab75838db2136e0a7f084bcd4a709f29e8ce8848'

const buildPayload = (payload: Partial<Record<string, unknown>>): Payload => payload as unknown as Payload

const resolve = (payload: Payload) => getTonChainSpecific({ keysignPayload: payload, walletCore: {} as never })

describe('getTonChainSpecific — seqno on an uninitialized wallet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetTonWalletState.mockResolvedValue('active')
  })

  it('does NOT throw and yields seqno 0 when account_state is absent (first send / uninitialized)', async () => {
    // getExtendedAddressInformation returns a result WITHOUT account_state for a
    // wallet that received funds but never sent — the pre-fix direct
    // `account_state.seqno` crashed here.
    mockGetTonAccountInfo.mockResolvedValueOnce({ balance: '1000000000' })
    const res = await resolve(buildPayload({ toAddress: bounceableAddress }))
    expect(res.sequenceNumber).toBe(0n)
  })

  it('reads the seqno from account_state for an initialized wallet', async () => {
    mockGetTonAccountInfo.mockResolvedValueOnce({ account_state: { wallet_id: 'w', seqno: 7 } })
    const res = await resolve(buildPayload({ toAddress: bounceableAddress }))
    expect(res.sequenceNumber).toBe(7n)
  })
})

describe('getTonChainSpecific — bounceable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetTonAccountInfo.mockResolvedValue({ account_state: { seqno: 1 } })
    mockGetTonWalletState.mockResolvedValue('active')
  })

  const swapPayload = { case: 'swapkitSwapPayload', value: { targetAddress: nonBounceableAddress } }

  it('sends a swap deposit bounceable even though the provider hands back a UQ address', async () => {
    const res = await resolve(buildPayload({ toAddress: nonBounceableAddress, swapPayload }))

    expect(res.bounceable).toBe(true)
  })

  it('sends a swap deposit bounceable without consulting the destination wallet state', async () => {
    mockGetTonWalletState.mockResolvedValue('uninit')

    const res = await resolve(buildPayload({ toAddress: nonBounceableAddress, swapPayload }))

    expect(res.bounceable).toBe(true)
  })

  it('does not mark a swap payload bounceable when the destination is missing', async () => {
    const res = await resolve(buildPayload({ toAddress: '', swapPayload }))

    expect(res.bounceable).toBe(false)
  })

  it('honours an EQ destination on a plain send', async () => {
    const res = await resolve(buildPayload({ toAddress: bounceableAddress }))

    expect(res.bounceable).toBe(true)
  })

  it('honours a UQ destination on a plain send', async () => {
    const res = await resolve(buildPayload({ toAddress: nonBounceableAddress }))

    expect(res.bounceable).toBe(false)
  })

  // The prefix check this replaced read a raw address as non-bounceable, so a
  // rejected transfer to a raw contract address was absorbed rather than refunded.
  it('defaults a raw destination to bounceable', async () => {
    const res = await resolve(buildPayload({ toAddress: rawAddress }))

    expect(res.bounceable).toBe(true)
  })

  it('sends non-bounceable to an undeployed destination, which could not accept a bounce', async () => {
    mockGetTonWalletState.mockResolvedValue('uninit')

    const res = await resolve(buildPayload({ toAddress: bounceableAddress }))

    expect(res.bounceable).toBe(false)
  })

  it('is not bounceable when there is no destination at all', async () => {
    const res = await resolve(buildPayload({ toAddress: '' }))

    expect(res.bounceable).toBe(false)
  })
})
