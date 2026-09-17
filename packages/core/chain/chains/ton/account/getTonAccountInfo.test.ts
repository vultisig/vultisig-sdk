import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@vultisig/core-config', () => ({ rootApiUrl: 'https://api.test' }))
vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({ queryUrl: vi.fn() }))

import { beginCell } from '@ton/core'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { buildTonV5R1StateInit } from '../walletV5R1'
import { getTonAccountInfo, getTonAccountSeqno } from './getTonAccountInfo'

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

describe('getTonAccountSeqno', () => {
  const w5 = buildTonV5R1StateInit({ publicKey: new Uint8Array(32).fill(0xaa) })
  const w5Code = shouldBePresent(w5.code).toBoc().toString('base64')
  const w5DataAtSeqno = (seqno: number) =>
    beginCell()
      .storeBit(true)
      .storeUint(seqno, 32)
      .storeSlice(shouldBePresent(w5.data).beginParse().skip(33))
      .endCell()
      .toBoc()
      .toString('base64')

  it('takes the seqno toncenter decoded for a known wallet contract', () => {
    expect(getTonAccountSeqno({ account_state: { '@type': 'wallet.v4.accountState', wallet_id: 'w', seqno: 7 } })).toBe(
      7
    )
  })

  it('is 0 for a wallet that has never sent, so the first request deploys it', () => {
    expect(getTonAccountSeqno({ account_state: undefined })).toBe(0)
    expect(getTonAccountSeqno({ account_state: { '@type': 'uninited.accountState', frozen_hash: '' } })).toBe(0)
  })

  // Toncenter does not decode W5, so a deployed W5 wallet arrives as raw code
  // and data; reading 0 here signed replays that the contract rejected.
  it('reads the seqno of a deployed W5 wallet out of its data cell', () => {
    expect(
      getTonAccountSeqno({ account_state: { '@type': 'raw.accountState', code: w5Code, data: w5DataAtSeqno(1) } })
    ).toBe(1)
    expect(
      getTonAccountSeqno({ account_state: { '@type': 'raw.accountState', code: w5Code, data: w5DataAtSeqno(4321) } })
    ).toBe(4321)
  })

  it('refuses to guess for a deployed contract that is neither decoded nor W5', () => {
    const otherCode = beginCell().storeUint(1, 8).endCell().toBoc().toString('base64')

    expect(() =>
      getTonAccountSeqno({ account_state: { '@type': 'raw.accountState', code: otherCode, data: w5DataAtSeqno(1) } })
    ).toThrow(/neither a known wallet nor W5/)
  })
})
