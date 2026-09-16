import { describe, expect, it } from 'vitest'

import { SolanaBlockhashExpiredError, toSolanaBlockhashExpiredError } from './solanaBlockhashExpired'

const signature = '2gB3ifNe2kSoJEYoVY7T4vw2z5ci9nL6WcQQuCC2ozCiURBwSfC9uGcCq9CS2pAzX7ed1xwyS4434BmSg2WhrZ7j'

describe('SolanaBlockhashExpiredError', () => {
  it('always asks for a new signing ceremony and names what it knows', () => {
    const error = new SolanaBlockhashExpiredError({ signature, lastValidBlockHeight: 312_456_789 })

    expect(error).toMatchObject({
      name: 'SolanaBlockhashExpiredError',
      recovery: 'resign',
      signature,
      lastValidBlockHeight: 312_456_789,
    })
    // No own `cause`: the SDK's broadcast wrapper would otherwise replace the
    // instance with a plain Error and consumers could no longer match on it.
    expect(Object.prototype.hasOwnProperty.call(error, 'cause')).toBe(false)
    expect(error.message).toContain(signature)
    expect(error.message).toContain('312456789')
    expect(error.message).toContain('new signing ceremony')
  })

  it('still reads as an expiry with no signature or deadline to report', () => {
    const error = new SolanaBlockhashExpiredError()

    expect(error.message).toMatch(/never seen on-chain\. Rebuild/)
    expect(toSolanaBlockhashExpiredError(error)).toBe(error)
  })
})

describe('toSolanaBlockhashExpiredError', () => {
  it('finds the instance through a cause chain and the SDK originalError wrapper', () => {
    const expired = new SolanaBlockhashExpiredError({ signature })
    const broadcastError = new Error(`BROADCAST_REJECTED (retryable=false): ${expired.message}`, { cause: expired })
    const wrapped = Object.assign(new Error('Failed to broadcast transaction on Solana'), {
      originalError: broadcastError,
    })

    expect(toSolanaBlockhashExpiredError(wrapped)).toBe(expired)
  })

  it('rebuilds the error from its message when a wrapper kept only the text', () => {
    const expired = new SolanaBlockhashExpiredError({ signature, lastValidBlockHeight: 42 })

    const rebuilt = toSolanaBlockhashExpiredError(new Error(expired.message))

    expect(rebuilt).toBeInstanceOf(SolanaBlockhashExpiredError)
    expect(rebuilt).toMatchObject({ signature, lastValidBlockHeight: 42, recovery: 'resign' })
  })

  it('does not classify other broadcast failures', () => {
    expect(
      toSolanaBlockhashExpiredError(new Error('Transaction simulation failed: Blockhash not found'))
    ).toBeUndefined()
    expect(toSolanaBlockhashExpiredError('insufficient lamports')).toBeUndefined()
    expect(toSolanaBlockhashExpiredError(undefined)).toBeUndefined()
  })
})
