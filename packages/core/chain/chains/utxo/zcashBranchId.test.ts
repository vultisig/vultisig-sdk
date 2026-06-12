import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getZcashBranchId,
  getZcashBranchIdHex,
  resetZcashBranchIdCacheForTests,
  zcashBranchIdToNumber,
  zcashBranchIdToWalletCoreHex,
} from './zcashBranchId'

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: vi.fn(),
}))

const queryUrlMock = vi.mocked(queryUrl)

describe('Zcash branch id', () => {
  beforeEach(() => {
    resetZcashBranchIdCacheForTests()
    queryUrlMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('converts consensus.nextblock to WalletCore little-endian hex', () => {
    expect(zcashBranchIdToWalletCoreHex('5437F330')).toBe('30f33754')
    expect(zcashBranchIdToNumber('5437F330')).toBe(0x5437f330)
  })

  it('rejects malformed branch ids', () => {
    expect(() => zcashBranchIdToWalletCoreHex('123')).toThrow('4-byte hex')
    expect(() => zcashBranchIdToWalletCoreHex('not-hex!')).toThrow('4-byte hex')
  })

  it('fetches and caches the live branch id', async () => {
    queryUrlMock.mockResolvedValue({
      result: {
        consensus: {
          nextblock: '5437f330',
        },
      },
      error: null,
    })

    await expect(getZcashBranchIdHex()).resolves.toBe('30f33754')
    await expect(getZcashBranchId()).resolves.toBe(0x5437f330)
    await expect(getZcashBranchIdHex()).resolves.toBe('30f33754')

    expect(queryUrlMock).toHaveBeenCalledTimes(1)
  })

  it('dedupes concurrent fetches', async () => {
    queryUrlMock.mockResolvedValue({
      result: {
        consensus: {
          nextblock: '5437f330',
        },
      },
      error: null,
    })

    await expect(Promise.all([getZcashBranchIdHex(), getZcashBranchIdHex()])).resolves.toEqual(['30f33754', '30f33754'])

    expect(queryUrlMock).toHaveBeenCalledTimes(1)
  })

  it('fails loud when RPC response has no branch id', async () => {
    queryUrlMock.mockResolvedValue({
      result: {
        consensus: {},
      },
      error: null,
    })

    await expect(getZcashBranchIdHex()).rejects.toThrow('consensus.nextblock')
  })

  it('times out when RPC does not respond', async () => {
    vi.useFakeTimers()

    queryUrlMock.mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'))
          })
        })
    )

    const promise = getZcashBranchIdHex()
    const expectation = expect(promise).rejects.toThrow('Zcash RPC timed out')

    await vi.advanceTimersByTimeAsync(10_000)

    await expectation
  })
})
