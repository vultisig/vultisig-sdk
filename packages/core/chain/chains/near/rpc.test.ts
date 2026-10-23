import { describe, expect, it } from 'vitest'

import { getNearRpcErrorName, NearRpcError, NearUnknownEntityError, toNearRpcError } from './rpc'

const ACCOUNT = 'feab75c08be2732f1976726b25190ee2fec15ecc6e895532243fb8f3fd54e7db'
const HASH = '6zgh2u9DqHHiXzdy9ouTP7oGky2T4nugqzqt9wJZwNFm'

// Verbatim error bodies from api.vultisig.com/near/, which drops `name` and `cause` (2026-10-21).
const nameless = (data: string, code = -32000, message = 'Server error') => ({ code, message, data })

describe('NEAR JSON-RPC error typing', () => {
  it('reads nearcore whole not-found messages as unknown entities when the endpoint drops the name', () => {
    const account = toNearRpcError('query', nameless(`account ${ACCOUNT} does not exist while viewing`))
    const transaction = toNearRpcError('tx', nameless(`Transaction ${HASH} doesn't exist`))

    expect(account).toBeInstanceOf(NearUnknownEntityError)
    expect(getNearRpcErrorName(account)).toBe('UNKNOWN_ACCOUNT')
    expect(transaction).toBeInstanceOf(NearUnknownEntityError)
    expect(getNearRpcErrorName(transaction)).toBe('UNKNOWN_TRANSACTION')
  })

  it('reads the structured names nearcore sends', () => {
    const error = toNearRpcError('query', {
      name: 'HANDLER_ERROR',
      cause: { name: 'UNKNOWN_ACCOUNT', info: { requested_account_id: ACCOUNT } },
      code: -32000,
      message: 'Server error',
      data: `account ${ACCOUNT} does not exist while viewing`,
    })

    expect(getNearRpcErrorName(error)).toBe('UNKNOWN_ACCOUNT')
  })

  it.each([
    ['a nested cause', { name: 'HANDLER_ERROR', cause: { name: 'TIMEOUT_ERROR' } }, 'TIMEOUT_ERROR'],
    ['a top-level name', { name: 'INTERNAL_ERROR' }, 'INTERNAL_ERROR'],
  ])('lets %s win over a not-found message', (_, structured, rpcName) => {
    const error = toNearRpcError('query', {
      ...structured,
      ...nameless(`account ${ACCOUNT} does not exist while viewing`),
    })

    expect(error).toBeInstanceOf(NearRpcError)
    expect(getNearRpcErrorName(error)).toBe(rpcName)
  })

  it.each([
    [`account ${ACCOUNT} does not exist while viewing, retry later`],
    [`node error: account ${ACCOUNT} does not exist while viewing`],
    [`Transaction  doesn't exist`],
    ['upstream request failed'],
  ])('keeps any other name-less failure unknown, never a missing record (%s)', data => {
    const error = toNearRpcError('query', nameless(data, -32603, 'Internal error'))

    expect(error).toBeInstanceOf(NearRpcError)
    expect(getNearRpcErrorName(error)).toBe('UNKNOWN_ERROR')
  })
})
