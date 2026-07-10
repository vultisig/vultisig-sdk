import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@vultisig/core-config', () => ({ rootApiUrl: 'https://api.test' }))
vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({ queryUrl: vi.fn() }))

import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { getTonAccountInfo } from './getTonAccountInfo'

describe('getTonAccountInfo', () => {
  beforeEach(() => {
    vi.mocked(queryUrl).mockReset()
  })

  it('returns the result for an initialized wallet', async () => {
    const result = { balance: '1000000000', account_state: { wallet_id: 'w', seqno: 7 } }
    vi.mocked(queryUrl).mockResolvedValueOnce({ ok: true, result } as never)

    await expect(getTonAccountInfo('EQinit')).resolves.toBe(result)
  })

  it('returns the uninited result (no account_state) so callers default seqno to 0', async () => {
    // A wallet that received funds but never sent — toncenter replies ok:true
    // with an `uninited.accountState` result that carries no `seqno`.
    const result = { balance: '5', account_state: { '@type': 'uninited.accountState' } }
    vi.mocked(queryUrl).mockResolvedValueOnce({ ok: true, result } as never)

    await expect(getTonAccountInfo('EQuninit')).resolves.toBe(result)
  })

  it('throws (not returns null) when toncenter replies ok:false with a null result', async () => {
    // The RPC-failure shape that previously slipped through as a 200 and made
    // the keysign resolver crash on `const { account_state } = undefined`.
    vi.mocked(queryUrl).mockResolvedValueOnce({ ok: false, result: null } as never)

    await expect(getTonAccountInfo('EQfail')).rejects.toThrow(/no result/)
  })

  it('throws when the body is missing entirely', async () => {
    vi.mocked(queryUrl).mockResolvedValueOnce(undefined as never)

    await expect(getTonAccountInfo('EQempty')).rejects.toThrow(/no result/)
  })
})
