import { describe, expect, it, vi } from 'vitest'

import { listAllSuiCoins, maxSuiCoinPages, unwrapSuiCoinType } from './listAllCoins'

const NATIVE = '0x2::sui::SUI'
const coinObject = (i: number, balance = '1', type = `0x2::coin::Coin<${NATIVE}>`) => ({
  objectId: `0xobj${i}`,
  version: `${i}`,
  digest: `dig${i}`,
  type,
  balance,
  owner: { $kind: 'AddressOwner' as const, AddressOwner: '0xowner' },
})

const client = (listCoins: ReturnType<typeof vi.fn>) => ({ listCoins }) as never

describe('unwrapSuiCoinType', () => {
  it('unwraps the Coin<> object type into the inner coin type', () => {
    expect(unwrapSuiCoinType('0x2::coin::Coin<0x2::sui::SUI>', 'fallback')).toBe('0x2::sui::SUI')
  })

  it('unwraps a fully-normalized wrapper type with generic parameters intact', () => {
    const inner = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'
    expect(
      unwrapSuiCoinType(`0x0000000000000000000000000000000000000000000000000000000000000002::coin::Coin<${inner}>`, 'x')
    ).toBe(inner)
  })

  it('falls back to the requested coin type when the object type is absent or unexpected', () => {
    expect(unwrapSuiCoinType(undefined, NATIVE)).toBe(NATIVE)
    expect(unwrapSuiCoinType('0x2::sui::SUI', NATIVE)).toBe(NATIVE)
  })
})

describe('listAllSuiCoins', () => {
  it('follows the cursor across pages and flattens to the keysign coin shape', async () => {
    const listCoins = vi
      .fn()
      .mockResolvedValueOnce({ objects: [coinObject(0), coinObject(1)], hasNextPage: true, cursor: 'cur1' })
      .mockResolvedValueOnce({ objects: [coinObject(2)], hasNextPage: false, cursor: null })

    const coins = await listAllSuiCoins({ client: client(listCoins), owner: '0xowner', coinType: NATIVE })

    expect(coins).toEqual([
      { coinType: NATIVE, coinObjectId: '0xobj0', version: '0', digest: 'dig0', balance: '1' },
      { coinType: NATIVE, coinObjectId: '0xobj1', version: '1', digest: 'dig1', balance: '1' },
      { coinType: NATIVE, coinObjectId: '0xobj2', version: '2', digest: 'dig2', balance: '1' },
    ])

    expect(listCoins).toHaveBeenCalledTimes(2)
    expect(listCoins.mock.calls[0]?.[0]).toEqual({ owner: '0xowner', coinType: NATIVE, cursor: undefined })
    // The cursor from each page is threaded into the next request — the whole
    // point of the loop. `cursor` replaced JSON-RPC's `nextCursor`.
    expect(listCoins.mock.calls[1]?.[0]).toEqual({ owner: '0xowner', coinType: NATIVE, cursor: 'cur1' })
  })

  it('terminates on a single page', async () => {
    const listCoins = vi.fn().mockResolvedValueOnce({ objects: [coinObject(0)], hasNextPage: false, cursor: null })

    await expect(
      listAllSuiCoins({ client: client(listCoins), owner: '0xowner', coinType: NATIVE })
    ).resolves.toHaveLength(1)
    expect(listCoins).toHaveBeenCalledTimes(1)
  })

  it('fails closed (throws, no infinite loop) when the cursor never advances', async () => {
    const listCoins = vi.fn().mockResolvedValue({ objects: [coinObject(0)], hasNextPage: true, cursor: 'stuck' })

    await expect(listAllSuiCoins({ client: client(listCoins), owner: '0xowner', coinType: NATIVE })).rejects.toThrow(
      /exceeded \d+ pages/
    )
    // Bounded, not unbounded.
    expect(listCoins).toHaveBeenCalledTimes(maxSuiCoinPages)
  })

  it('does not truncate when hasNextPage is true but the cursor is null', async () => {
    // A page that claims more data yet hands back no cursor cannot be followed;
    // stopping is correct (and must not loop forever on `undefined`).
    const listCoins = vi.fn().mockResolvedValue({ objects: [coinObject(0)], hasNextPage: true, cursor: null })

    await expect(
      listAllSuiCoins({ client: client(listCoins), owner: '0xowner', coinType: NATIVE })
    ).resolves.toHaveLength(1)
    expect(listCoins).toHaveBeenCalledTimes(1)
  })
})
