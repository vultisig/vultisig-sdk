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
        tx_json: { Fee: '20', TransactionType: 'Payment' },
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

  it('reports the authoritative issued-currency delivered_amount', async () => {
    mocks.request.mockResolvedValue({
      result: {
        validated: true,
        meta: {
          TransactionResult: 'tesSUCCESS',
          delivered_amount: {
            currency: '524C555344000000000000000000000000000000',
            issuer: 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De',
            value: '1.25',
          },
        },
        tx_json: { Fee: '20', TransactionType: 'Payment' },
      },
    })

    const result = await getRippleTxStatus({ chain: OtherChain.Ripple, hash })
    expect(result.receipt).toMatchObject({
      deliveredAmount: '1.25',
      deliveredCurrency: '524C555344000000000000000000000000000000',
      deliveredIssuer: 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De',
    })
  })

  it('reports native XRP delivered_amount in drops', async () => {
    mocks.request.mockResolvedValue({
      result: {
        validated: true,
        meta: { TransactionResult: 'tesSUCCESS', delivered_amount: '1250000' },
        tx_json: { Fee: '20', TransactionType: 'Payment' },
      },
    })

    const result = await getRippleTxStatus({ chain: OtherChain.Ripple, hash })
    expect(result.receipt).toMatchObject({
      deliveredAmount: '1250000',
      deliveredCurrency: 'XRP',
    })
  })

  it('reports an MPT delivered_amount without treating it as issued currency', async () => {
    const mptIssuanceId = '000004C463C52827307480341125DA0577DEFC38405B0E3E'
    mocks.request.mockResolvedValue({
      result: {
        validated: true,
        meta: {
          TransactionResult: 'tesSUCCESS',
          delivered_amount: { mpt_issuance_id: mptIssuanceId, value: '42' },
        },
        tx_json: { Fee: '20', TransactionType: 'Payment' },
      },
    })

    const result = await getRippleTxStatus({ chain: OtherChain.Ripple, hash })
    expect(result.receipt).toMatchObject({
      deliveredAmount: '42',
      deliveredMptIssuanceId: mptIssuanceId,
    })
    expect(result.receipt).not.toHaveProperty('deliveredCurrency')
    expect(result.receipt).not.toHaveProperty('deliveredIssuer')
  })

  it('reads the deprecated serialized DeliveredAmount fallback when delivered_amount is absent', async () => {
    mocks.request.mockResolvedValue({
      result: {
        validated: true,
        meta: {
          TransactionResult: 'tesSUCCESS',
          DeliveredAmount: {
            currency: 'USD',
            issuer: 'rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B',
            value: '8.5',
          },
        },
        tx_json: { Fee: '20', TransactionType: 'Payment' },
      },
    })

    const result = await getRippleTxStatus({ chain: OtherChain.Ripple, hash })
    expect(result.receipt).toMatchObject({
      deliveredAmount: '8.5',
      deliveredCurrency: 'USD',
      deliveredIssuer: 'rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B',
    })
  })

  it('does not fall back to DeliveredAmount when delivered_amount is present but malformed', async () => {
    mocks.request.mockResolvedValue({
      result: {
        validated: true,
        meta: {
          TransactionResult: 'tesSUCCESS',
          delivered_amount: 'unavailable',
          DeliveredAmount: '1250000',
        },
        tx_json: { Fee: '20', TransactionType: 'Payment' },
      },
    })

    const result = await getRippleTxStatus({ chain: OtherChain.Ripple, hash })
    expect(result.receipt).not.toHaveProperty('deliveredAmount')
  })

  it('never falls back to send-side Amount or DeliverMax', async () => {
    mocks.request.mockResolvedValue({
      result: {
        validated: true,
        meta: { TransactionResult: 'tesSUCCESS', Amount: '999999999' },
        tx_json: { Fee: '20', TransactionType: 'Payment', Amount: '999999999', DeliverMax: '999999999' },
      },
    })

    const result = await getRippleTxStatus({ chain: OtherChain.Ripple, hash })
    expect(result.receipt).not.toHaveProperty('deliveredAmount')
  })

  it('does not expose the historical delivered_amount unavailable sentinel as a value', async () => {
    mocks.request.mockResolvedValue({
      result: {
        validated: true,
        meta: {
          TransactionResult: 'tesSUCCESS',
          delivered_amount: 'unavailable',
        },
        tx_json: { Fee: '20', TransactionType: 'Payment' },
      },
    })

    const result = await getRippleTxStatus({ chain: OtherChain.Ripple, hash })
    expect(result.receipt).not.toHaveProperty('deliveredAmount')
  })

  it('returns status:error when tx is validated but TransactionResult is not tesSUCCESS', async () => {
    mocks.request.mockResolvedValue({
      result: {
        validated: true,
        meta: { TransactionResult: 'tecUNFUNDED_PAYMENT' },
        tx_json: { Fee: '20', TransactionType: 'Payment' },
      },
    })

    const result = await getRippleTxStatus({ chain: OtherChain.Ripple, hash })
    expect(result.status).toBe('error')
  })

  it.each([
    'unavailable',
    'NaN',
    '-1',
    {},
    { value: '1' },
    { value: 'NaN', currency: 'USD', issuer: 'rIssuer' },
    { value: '1', currency: 'XRP', issuer: 'rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B' },
    { value: '1', currency: 'US', issuer: 'rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B' },
    { value: '1', currency: 'USD', issuer: 'rInvalid' },
    { value: '1', mpt_issuance_id: 'NOT_AN_MPT_ID' },
    {
      value: '1',
      mpt_issuance_id: '000004C463C52827307480341125DA0577DEFC38405B0E3E',
      currency: 'USD',
      issuer: 'rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B',
    },
    { value: '9223372036854775808', mpt_issuance_id: '000004C463C52827307480341125DA0577DEFC38405B0E3E' },
    {
      value: '999999999999999999999999999999999999999999999999999999999999',
      mpt_issuance_id: '000004C463C52827307480341125DA0577DEFC38405B0E3E',
    },
  ])('omits malformed delivered amounts: %j', async delivered_amount => {
    mocks.request.mockResolvedValue({
      result: {
        validated: true,
        meta: { TransactionResult: 'tesSUCCESS', delivered_amount },
        tx_json: { Fee: '20', TransactionType: 'Payment' },
      },
    })
    const result = await getRippleTxStatus({ chain: OtherChain.Ripple, hash })
    expect(result.receipt).not.toHaveProperty('deliveredAmount')
    expect(result.receipt).not.toHaveProperty('deliveredCurrency')
    expect(result.receipt).not.toHaveProperty('deliveredIssuer')
  })

  it('does not report delivery on a failed transaction', async () => {
    mocks.request.mockResolvedValue({
      result: {
        validated: true,
        meta: { TransactionResult: 'tecPATH_DRY', delivered_amount: '100' },
        tx_json: { Fee: '20', TransactionType: 'Payment' },
      },
    })
    const result = await getRippleTxStatus({ chain: OtherChain.Ripple, hash })
    expect(result.receipt).not.toHaveProperty('deliveredAmount')
  })

  it('does not interpret non-Payment DeliveredAmount metadata as a Payment delivery', async () => {
    mocks.request.mockResolvedValue({
      result: {
        validated: true,
        meta: { TransactionResult: 'tesSUCCESS', DeliveredAmount: '1250000' },
        tx_json: { Fee: '20', TransactionType: 'AccountDelete' },
      },
    })

    const result = await getRippleTxStatus({ chain: OtherChain.Ripple, hash })
    expect(result.receipt).not.toHaveProperty('deliveredAmount')
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

  it('returns isKnown:false on response missing `result` field (CR finding)', async () => {
    // A `{}` payload from a misbehaving RPC has no `result`. Pre-fix this
    // bypassed the !response guard and crashed at destructure time. Now
    // it routes through the same safe path as txnNotFound.
    mocks.request.mockResolvedValue({})

    const result = await getRippleTxStatus({ chain: OtherChain.Ripple, hash })
    expect(result).toEqual({ status: 'pending', isKnown: false })
  })

  it('returns isKnown:false on response with null result', async () => {
    mocks.request.mockResolvedValue({ result: null })

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
