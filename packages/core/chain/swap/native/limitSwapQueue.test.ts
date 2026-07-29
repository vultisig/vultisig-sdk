import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({ queryUrl: vi.fn() }))

import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { getLimitSwapQueue, parseLimitSwapQueue } from './limitSwapQueue'

/** The populated shape as observed live on mainnet: object envelope, string numerics. */
const liveEntry = {
  time_to_expiry_blocks: '13056',
  blocks_since_created: '1344',
  swap: {
    tx: {
      id: '5CB3698C77FC719202EB1AEE5C5060B12A86E0BC086B0BB0DCC176711640F9C3',
      from_address: 'thor12a9rpf9u2ulwuezxkh6uas4au7xnde8umdua5t',
      memo: '=<:ETH.USDC-06EB48:0x14F6Ed6CBb27b607b0E2A48551A988F1a19c89B6:43079145/14400/0:v0:50',
      coins: [{ asset: 'THOR.RUNE', amount: '100000000' }],
    },
    state: {
      deposit: '100000000',
      in: '25000000',
      out: '10769786',
      failed_swap_reasons: ['emit asset 42000000 less than price limit 43079145'],
    },
    target_asset: 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48',
    trade_target: '43079145',
  },
}

describe('parseLimitSwapQueue', () => {
  it('parses a live entry into a typed resting order', () => {
    const [entry] = parseLimitSwapQueue({ limit_swaps: [liveEntry] }) ?? []

    expect(entry).toEqual({
      txId: '5CB3698C77FC719202EB1AEE5C5060B12A86E0BC086B0BB0DCC176711640F9C3',
      fromAddress: 'thor12a9rpf9u2ulwuezxkh6uas4au7xnde8umdua5t',
      memo: '=<:ETH.USDC-06EB48:0x14F6Ed6CBb27b607b0E2A48551A988F1a19c89B6:43079145/14400/0:v0:50',
      sourceAsset: 'THOR.RUNE',
      targetAsset: 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48',
      tradeTarget: 43_079_145n,
      deposit: 100_000_000n,
      amountIn: 25_000_000n,
      amountOut: 10_769_786n,
      failedSwapReasons: ['emit asset 42000000 less than price limit 43079145'],
      timeToExpiryBlocks: 13_056,
      blocksSinceCreated: 1_344,
    })
  })

  // THORNode renders assets through Asset.MarshalJSON (flat string) on some
  // routes and protobuf-JSON (an object of fields) on others. Both must decode
  // to the memo spelling, separator per flavour.
  it.each([
    ['a layer-1 object', { chain: 'ETH', symbol: 'ETH' }, 'ETH.ETH'],
    ['a synth object', { chain: 'BTC', symbol: 'BTC', synth: true }, 'BTC/BTC'],
    ['a trade object', { chain: 'BTC', symbol: 'BTC', trade: true }, 'BTC~BTC'],
    ['a secured object', { chain: 'XRP', symbol: 'XRP', secured: true }, 'XRP-XRP'],
  ])('decodes %s asset to memo notation', (_label, asset, expected) => {
    const entries = parseLimitSwapQueue({
      limit_swaps: [{ swap: { tx: { id: 'AB' }, target_asset: asset } }],
    })

    expect(entries?.[0].targetAsset).toBe(expected)
  })

  // An order's disappearance from this list is what marks it terminal, so
  // "empty" must be an explicit claim. An absent key is no information — if it
  // flattened to [], every tracked order would close at once on the strength of
  // a response we didn't understand.
  it('distinguishes an absent limit_swaps key from an explicit empty queue', () => {
    expect(parseLimitSwapQueue({})).toBeNull()
    expect(parseLimitSwapQueue({ limit_swaps: null })).toBeNull()
    expect(parseLimitSwapQueue({ limit_swaps: [] })).toEqual([])
  })

  it.each([
    ['a non-object response', 'nope'],
    ['a non-array limit_swaps', { limit_swaps: 42 }],
    ['an entry with no swap', { limit_swaps: [{}] }],
    ['an entry with no tx id', { limit_swaps: [{ swap: { tx: {} } }] }],
    ['a non-integer amount', { limit_swaps: [{ swap: { tx: { id: 'AB' }, trade_target: '1.5' } }] }],
    ['an undecodable asset', { limit_swaps: [{ swap: { tx: { id: 'AB' }, target_asset: 42 } }] }],
    [
      'non-array failed_swap_reasons',
      { limit_swaps: [{ swap: { tx: { id: 'AB' }, state: { failed_swap_reasons: 'oops' } } }] },
    ],
    [
      'non-string entries in failed_swap_reasons',
      { limit_swaps: [{ swap: { tx: { id: 'AB' }, state: { failed_swap_reasons: [42] } } }] },
    ],
  ])('throws on %s rather than guessing', (_label, body) => {
    expect(() => parseLimitSwapQueue(body)).toThrow()
  })

  // Attempts that missed are a real, stable resting state — not failures.
  it('keeps failed_swap_reasons as data, defaulting to empty', () => {
    const entries = parseLimitSwapQueue({
      limit_swaps: [{ swap: { tx: { id: 'AB' } } }],
    })

    expect(entries?.[0].failedSwapReasons).toEqual([])
  })

  it('leaves absent optional fields undefined', () => {
    const [entry] = parseLimitSwapQueue({ limit_swaps: [{ swap: { tx: { id: 'AB' } } }] }) ?? []

    expect(entry.deposit).toBeUndefined()
    expect(entry.tradeTarget).toBeUndefined()
    expect(entry.timeToExpiryBlocks).toBeUndefined()
  })
})

describe('getLimitSwapQueue', () => {
  beforeEach(() => vi.mocked(queryUrl).mockReset())

  // A sender with more than one page of resting orders must not have page 2's
  // orders silently dropped — an order resting on page 2 would otherwise read
  // as "absent from the queue", which callers treat as the order having
  // closed.
  it('walks pages while pagination.has_next is true and concatenates results', async () => {
    vi.mocked(queryUrl)
      .mockResolvedValueOnce({
        limit_swaps: [{ swap: { tx: { id: 'A' } } }],
        pagination: { limit: '100', has_next: true },
      } as never)
      .mockResolvedValueOnce({
        limit_swaps: [{ swap: { tx: { id: 'B' } } }],
        pagination: { limit: '100', has_next: false },
      } as never)

    const res = await getLimitSwapQueue('thor1abc')

    expect(res?.map(entry => entry.txId)).toEqual(['A', 'B'])
    expect(vi.mocked(queryUrl)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(queryUrl).mock.calls[0]?.[0]).toContain('pagination.offset=0')
    expect(vi.mocked(queryUrl).mock.calls[1]?.[0]).toContain('pagination.offset=100')
  })

  it('stops after one page when has_next is false', async () => {
    vi.mocked(queryUrl).mockResolvedValueOnce({
      limit_swaps: [{ swap: { tx: { id: 'A' } } }],
      pagination: { limit: '100', has_next: false },
    } as never)

    const res = await getLimitSwapQueue('thor1abc')

    expect(res).toHaveLength(1)
    expect(vi.mocked(queryUrl)).toHaveBeenCalledTimes(1)
  })

  it('treats an absent limit_swaps key on the first page as no information, not an empty queue', async () => {
    vi.mocked(queryUrl).mockResolvedValueOnce({} as never)

    const res = await getLimitSwapQueue('thor1abc')

    expect(res).toBeNull()
  })

  it('keeps already-collected entries when a later page is unrecognised, rather than discarding them', async () => {
    vi.mocked(queryUrl)
      .mockResolvedValueOnce({
        limit_swaps: [{ swap: { tx: { id: 'A' } } }],
        pagination: { limit: '100', has_next: true },
      } as never)
      .mockResolvedValueOnce({} as never)

    const res = await getLimitSwapQueue('thor1abc')

    expect(res?.map(entry => entry.txId)).toEqual(['A'])
  })

  it('caps the page walk so a never-false has_next cannot loop forever', async () => {
    vi.mocked(queryUrl).mockResolvedValue({
      limit_swaps: [{ swap: { tx: { id: 'X' } } }],
      pagination: { limit: '100', has_next: true },
    } as never)

    const res = await getLimitSwapQueue('thor1abc')

    // MAX_PAGES = 50, deduped down to the one repeated txId.
    expect(vi.mocked(queryUrl)).toHaveBeenCalledTimes(50)
    expect(res).toHaveLength(1)
  })
})
