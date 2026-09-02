import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetCoinBalance,
  mockGetJettonWalletAddress,
  mockGetKeysignCoin,
  mockGetTonAccountInfo,
  mockGetTonWalletState,
} = vi.hoisted(() => ({
  mockGetCoinBalance: vi.fn(async () => 0n),
  mockGetJettonWalletAddress: vi.fn(),
  mockGetKeysignCoin: vi.fn(),
  mockGetTonAccountInfo: vi.fn(),
  mockGetTonWalletState: vi.fn(),
}))

vi.mock('@vultisig/core-chain/chains/ton/account/getTonAccountInfo', () => ({
  getTonAccountInfo: mockGetTonAccountInfo,
}))
vi.mock('@vultisig/core-chain/chains/ton/api', () => ({
  getJettonWalletAddress: mockGetJettonWalletAddress,
  getTonWalletState: mockGetTonWalletState,
}))
vi.mock('@vultisig/core-chain/coin/balance', () => ({
  getCoinBalance: mockGetCoinBalance,
}))
vi.mock('../../../fee/resolvers/ton', () => ({ getTonFeeAmount: () => 0n }))
vi.mock('../../../utils/getKeysignCoin', () => ({
  getKeysignCoin: mockGetKeysignCoin,
}))
vi.mock('../../../utils/getKeysignAmount', () => ({
  getKeysignAmount: () => 0n,
}))

import { getTonChainSpecific } from './index'

type Payload = Parameters<typeof getTonChainSpecific>[0]['keysignPayload']

const bounceableAddress = 'EQDmLe6ticcY_uLZsfurdYONshNuCn8IS81KcJ8p6M6ISJrE'
const nonBounceableAddress = 'UQDmLe6ticcY_uLZsfurdYONshNuCn8IS81KcJ8p6M6ISMcB'
const rawAddress = '0:e62deead89c718fee2d9b1fbab75838db2136e0a7f084bcd4a709f29e8ce8848'
const nativeCoin = { address: 'srcAddr', ticker: 'TON', id: undefined }
const jettonCoin = { address: 'srcAddr', ticker: 'USDT', id: 'EQjettonMaster' }
const senderJettonWallet = 'EQCIcjES4cQET0z6nRixZ0MdvTB4u3_8triztLSrIIrDkpgJ'

const buildPayload = (payload: Partial<Record<string, unknown>>): Payload => payload as unknown as Payload

const resolve = (payload: Payload) => getTonChainSpecific({ keysignPayload: payload, walletCore: {} as never })

describe('getTonChainSpecific — seqno on an uninitialized wallet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetKeysignCoin.mockReturnValue(nativeCoin)
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
    mockGetTonAccountInfo.mockResolvedValueOnce({
      account_state: { wallet_id: 'w', seqno: 7 },
    })
    const res = await resolve(buildPayload({ toAddress: bounceableAddress }))
    expect(res.sequenceNumber).toBe(7n)
  })
})

describe('getTonChainSpecific — sendMaxAmount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetKeysignCoin.mockReturnValue(nativeCoin)
    mockGetTonAccountInfo.mockResolvedValue({ account_state: { seqno: 1 } })
    mockGetTonWalletState.mockResolvedValue('active')
    mockGetCoinBalance.mockResolvedValue(1_000_000_000n)
  })

  // Amount sits one nanoton under the balance above, which the removed heuristic read
  // as a MAX send.
  const nearBalancePayload = buildPayload({
    toAddress: bounceableAddress,
    toAmount: '999999999',
  })

  it('records the flag the caller passed, whatever the amount looks like', async () => {
    const dustSend = buildPayload({ toAddress: bounceableAddress, toAmount: '1' })

    const res = await getTonChainSpecific({
      keysignPayload: dustSend,
      walletCore: {} as never,
      sendMaxAmount: true,
    })

    expect(res.sendMaxAmount).toBe(true)
  })

  // The removed heuristic flagged any `amount + fee >= balance` send as MAX, so typing
  // an amount near your balance silently relabelled an ordinary send.
  it('leaves a near-balance send unflagged when the caller did not ask for MAX', async () => {
    const res = await resolve(nearBalancePayload)

    expect(res.sendMaxAmount).toBe(false)
  })

  it('does not read the balance at all — nothing is inferred from it', async () => {
    await resolve(nearBalancePayload)

    expect(mockGetCoinBalance).not.toHaveBeenCalled()
  })
})

describe('getTonChainSpecific — bounceable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetKeysignCoin.mockReturnValue(nativeCoin)
    mockGetTonAccountInfo.mockResolvedValue({ account_state: { seqno: 1 } })
    mockGetTonWalletState.mockResolvedValue('active')
  })

  const swapPayload = {
    case: 'swapkitSwapPayload',
    value: { targetAddress: nonBounceableAddress },
  }

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

describe('getTonChainSpecific — jetton wallet resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetKeysignCoin.mockReturnValue(jettonCoin)
    mockGetTonAccountInfo.mockResolvedValue({ account_state: { seqno: 1 } })
    mockGetTonWalletState.mockResolvedValue('active')
    mockGetJettonWalletAddress.mockResolvedValue(senderJettonWallet)
  })

  it('records the resolved sender jetton wallet', async () => {
    const res = await resolve(buildPayload({ toAddress: bounceableAddress }))

    expect(res.jettonAddress).toBe(senderJettonWallet)
  })

  // Before this, a failed lookup left jettonAddress as '' and the payload was built
  // anyway — the empty string passed every null/undefined check downstream and became
  // a transfer with no destination.
  it('refuses to build a payload when the lookup fails', async () => {
    mockGetJettonWalletAddress.mockRejectedValue(new Error('No jetton wallet found'))

    await expect(resolve(buildPayload({ toAddress: bounceableAddress }))).rejects.toThrow(
      /Unable to resolve the USDT jetton wallet/
    )
  })

  it('keeps the underlying failure as the cause', async () => {
    const cause = new Error('No jetton wallet found')
    mockGetJettonWalletAddress.mockRejectedValue(cause)

    await expect(resolve(buildPayload({ toAddress: bounceableAddress }))).rejects.toMatchObject({ cause })
  })

  it.each([
    ['an empty string', ''],
    ['blank whitespace', '   '],
  ])('refuses to build a payload when the lookup returns %s', async (_, resolved) => {
    mockGetJettonWalletAddress.mockResolvedValue(resolved)

    await expect(resolve(buildPayload({ toAddress: bounceableAddress }))).rejects.toThrow(
      /Unable to resolve the USDT jetton wallet/
    )
  })

  it('never consults the jetton lookup for a native TON send', async () => {
    mockGetKeysignCoin.mockReturnValue(nativeCoin)

    const res = await resolve(buildPayload({ toAddress: bounceableAddress }))

    expect(mockGetJettonWalletAddress).not.toHaveBeenCalled()
    expect(res.jettonAddress).toBe('')
  })
})

describe('getTonChainSpecific — expireAt honours a dApp deadline', () => {
  const now = 1_753_579_000

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ now: now * 1000 })
    mockGetKeysignCoin.mockReturnValue(nativeCoin)
    mockGetTonAccountInfo.mockResolvedValue({ account_state: { seqno: 1 } })
    mockGetTonWalletState.mockResolvedValue('active')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const payload = buildPayload({ toAddress: bounceableAddress, toAmount: '1' })

  it('signs the wallet default of ten minutes when the caller sets no deadline', async () => {
    const res = await resolve(payload)

    expect(res.expireAt).toBe(BigInt(now + 600))
  })

  it('tightens the expiry to a dApp deadline that comes sooner', async () => {
    const res = await getTonChainSpecific({ keysignPayload: payload, walletCore: {} as never, validUntil: now + 60 })

    expect(res.expireAt).toBe(BigInt(now + 60))
  })

  // The dApp's window can only shrink the wallet's own; a generous deadline must not
  // keep a signed message replayable for longer than ten minutes.
  it('keeps the wallet default when the dApp deadline is later', async () => {
    const res = await getTonChainSpecific({ keysignPayload: payload, walletCore: {} as never, validUntil: now + 3600 })

    expect(res.expireAt).toBe(BigInt(now + 600))
  })

  it('floors a fractional deadline to whole seconds', async () => {
    const res = await getTonChainSpecific({ keysignPayload: payload, walletCore: {} as never, validUntil: now + 60.9 })

    expect(res.expireAt).toBe(BigInt(now + 60))
  })

  // `now + 0.5` is in the future by the raw comparison but floors to `now`, which
  // would sign a message already expired at broadcast. The rejection names the
  // deadline as the dApp sent it, so the caller can see what was refused.
  it('fails the build for a deadline less than a second away', async () => {
    const deadline = now + 0.5

    await expect(
      getTonChainSpecific({ keysignPayload: payload, walletCore: {} as never, validUntil: deadline })
    ).rejects.toThrow(`valid_until ${deadline}) has already passed`)
  })

  it('fails the build for a deadline that has already passed', async () => {
    const deadline = now - 1

    await expect(
      getTonChainSpecific({ keysignPayload: payload, walletCore: {} as never, validUntil: deadline })
    ).rejects.toThrow(`valid_until ${deadline}) has already passed`)
  })
})
