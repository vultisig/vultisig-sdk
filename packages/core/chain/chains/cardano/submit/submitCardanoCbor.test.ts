import { afterEach, describe, expect, it, vi } from 'vitest'

import { submitCardanoCbor } from './submitCardanoCbor'

const respondWith = (body: unknown, status: number) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status }))
  )

describe('submitCardanoCbor', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the transaction id the node accepted', async () => {
    respondWith({ jsonrpc: '2.0', method: 'submitTransaction', result: { transaction: { id: '0xABCD' } }, id: 1 }, 200)

    await expect(submitCardanoCbor('84a0')).resolves.toMatchObject({ txHash: 'ABCD', errorMessage: null })
  })

  it('surfaces the justification of a mempool rejection instead of the message that only points at it', async () => {
    // Verbatim reply to resubmitting a transaction that is already included.
    respondWith(
      {
        jsonrpc: '2.0',
        method: 'submitTransaction',
        error: {
          code: 3997,
          message: "The transaction couldn't be added to the mempool. A justification is given as 'data.error'.",
          data: { error: 'All inputs are spent. Transaction has probably already been included' },
        },
        id: 1,
      },
      400
    )

    await expect(submitCardanoCbor('84a0')).resolves.toMatchObject({
      txHash: null,
      errorMessage: 'All inputs are spent. Transaction has probably already been included',
      rpcErrorCode: 3997,
      rpcErrorDetail: 'All inputs are spent. Transaction has probably already been included',
    })
  })

  it('keeps the node message when the error data is structured rather than a justification', async () => {
    respondWith(
      {
        jsonrpc: '2.0',
        method: 'submitTransaction',
        error: {
          code: 3117,
          message: 'The transaction contains unknown UTxO references as inputs.',
          data: { unknownOutputReferences: [{ transaction: { id: 'aa' }, index: 0 }] },
        },
        id: 1,
      },
      400
    )

    const result = await submitCardanoCbor('84a0')

    expect(result).toMatchObject({
      txHash: null,
      errorMessage: 'The transaction contains unknown UTxO references as inputs.',
      rpcErrorCode: 3117,
    })
    expect(result.rpcErrorDetail).toBeUndefined()
  })
})
