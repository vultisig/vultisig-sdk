import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
}))

vi.mock('@vultisig/core-chain/chains/ripple/client', () => ({
  getRippleClient: () => ({
    request: mocks.request,
  }),
}))

import { OtherChain } from '../../../Chain'
import { getRippleTxStatus } from './ripple'

describe('getRippleTxStatus', () => {
  const hash = 'C029493643AF80C6977BF0B30CF4A1E128EA98689BF303273219122A8DBECCDA'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns status:success with receipt when tx is validated and tesSUCCESS', async () => {
    mocks.request.mockResolvedValue({
      result: {
        validated: true,
        meta: { TransactionResult: 'tesSUCCESS' },
        tx_json: { Fee: '20' },
      },
    })

    const result = await getRippleTxStatus({ chain: OtherChain.Ripple, hash })
    expect(result.status).toBe('success')
    expect(result.receipt).toMatchObject({
      feeAmount: BigInt(20),
      feeDecimals: 6,
      feeTicker: 'XRP',
    })
  })

  it('returns status:error when tx is validated but TransactionResult is not tesSUCCESS', async () => {
    mocks.request.mockResolvedValue({
      result: {
        validated: true,
        meta: { TransactionResult: 'tecUNFUNDED_PAYMENT' },
        tx_json: { Fee: '20' },
      },
    })

    const result = await getRippleTxStatus({ chain: OtherChain.Ripple, hash })
    expect(result.status).toBe('error')
  })

  it('returns isKnown:false for txnNotFound — verify-by-hash MUST NOT swallow broadcast errors for unknown hashes', async () => {
    // Regression for the silent-broadcast bug: the broadcast resolver
    // catches engine-level rejections (temREDUNDANT, tecXXX, etc.) and
    // routes specifically the peer-race codes (tefALREADY/tefPAST_SEQ)
    // through verifyBroadcastByHash. That safety net swallows the error
    // when `getRippleTxStatus` returns `{ status: 'pending', isKnown: true }`
    // (legitimate peer race: tx is genuinely in flight). When the chain
    // says it doesn't know the hash, we MUST mark `isKnown: false` so
    // verify-by-hash rethrows the original error rather than reporting
    // a fake success. Mirrors solana.ts:19.
    mocks.request.mockRejectedValue(new Error('txnNotFound'))

    const result = await getRippleTxStatus({ chain: OtherChain.Ripple, hash })
    expect(result).toEqual({ status: 'pending', isKnown: false })
  })

  it('returns isKnown:true when tx is in the ledger but not yet validated', async () => {
    // XRPL knows about the tx but hasn't run consensus on it yet. This
    // is the "genuinely in flight" state and the legitimate peer-race
    // case where verify-by-hash should swallow.
    mocks.request.mockResolvedValue({
      result: { validated: false, tx_json: { Fee: '20' } },
    })

    const result = await getRippleTxStatus({ chain: OtherChain.Ripple, hash })
    expect(result).toEqual({ status: 'pending', isKnown: true })
  })

  it('returns isKnown:false on null/undefined response (defensive)', async () => {
    mocks.request.mockResolvedValue(null)

    const result = await getRippleTxStatus({ chain: OtherChain.Ripple, hash })
    expect(result).toEqual({ status: 'pending', isKnown: false })
  })

  it('omits receipt when Fee is missing on success', async () => {
    mocks.request.mockResolvedValue({
      result: {
        validated: true,
        meta: { TransactionResult: 'tesSUCCESS' },
        tx_json: {},
      },
    })

    const result = await getRippleTxStatus({ chain: OtherChain.Ripple, hash })
    expect(result.status).toBe('success')
    expect(result.receipt).toBeUndefined()
  })
})
