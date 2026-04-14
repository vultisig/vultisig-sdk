import { afterEach, describe, expect, it, vi } from 'vitest'

import { checkProofServiceHealth, generateClaimProof } from './proofService'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

const mockFetch = (body: unknown, status = 200) => {
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  ) as typeof fetch
}

describe('checkProofServiceHealth', () => {
  it('returns true when healthy and setup loaded', async () => {
    mockFetch({ status: 'healthy', setup_loaded: true })

    const result = await checkProofServiceHealth({
      baseUrl: 'http://localhost:8090',
    })

    expect(result).toBe(true)
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8090/health'
    )
  })

  it('returns false when not healthy', async () => {
    mockFetch({ status: 'unhealthy', setup_loaded: true })

    const result = await checkProofServiceHealth({
      baseUrl: 'http://localhost:8090',
    })

    expect(result).toBe(false)
  })

  it('returns false on network error', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network error')
    }) as typeof fetch

    const result = await checkProofServiceHealth({
      baseUrl: 'http://localhost:8090',
    })

    expect(result).toBe(false)
  })

  it('returns false on non-OK response', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('', { status: 503 })
    ) as typeof fetch

    const result = await checkProofServiceHealth({
      baseUrl: 'http://localhost:8090',
    })

    expect(result).toBe(false)
  })

  it('returns false when setup not loaded', async () => {
    mockFetch({ status: 'healthy', setup_loaded: false })

    const result = await checkProofServiceHealth({
      baseUrl: 'http://localhost:8090',
    })

    expect(result).toBe(false)
  })
})

describe('generateClaimProof', () => {
  const validInput = {
    signatureR: 'aa'.repeat(24),
    signatureS: 'bb'.repeat(32),
    publicKey: '02' + 'cc'.repeat(32),
    utxos: [{ txid: 'dd'.repeat(32), vout: 0 }],
    claimerAddress: 'qbtc1abc',
    chainId: 'qbtc-1',
    baseUrl: 'http://localhost:8090',
  }

  const validResponse = {
    proof: 'ff'.repeat(100),
    message_hash: 'aa'.repeat(32),
    address_hash: 'bb'.repeat(20),
    qbtc_address_hash: 'cc'.repeat(32),
    utxos: [{ txid: 'dd'.repeat(32), vout: 0 }],
    claimer_address: 'qbtc1abc',
  }

  it('sends correctly formatted request', async () => {
    mockFetch(validResponse)

    await generateClaimProof(validInput)

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8090/prove',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signature_r: validInput.signatureR,
          signature_s: validInput.signatureS,
          public_key: validInput.publicKey,
          utxos: validInput.utxos,
          claimer_address: validInput.claimerAddress,
          chain_id: validInput.chainId,
        }),
      })
    )
  })

  it('returns parsed proof response', async () => {
    mockFetch(validResponse)

    const result = await generateClaimProof(validInput)

    expect(result.proof).toBe(validResponse.proof)
    expect(result.message_hash).toBe(validResponse.message_hash)
    expect(result.address_hash).toBe(validResponse.address_hash)
    expect(result.qbtc_address_hash).toBe(validResponse.qbtc_address_hash)
    expect(result.claimer_address).toBe('qbtc1abc')
  })

  it('throws on non-OK response', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('proof verification failed', { status: 400 })
    ) as typeof fetch

    await expect(generateClaimProof(validInput)).rejects.toThrow(
      'Proof service error (400): proof verification failed'
    )
  })

  it('throws on invalid response fields', async () => {
    mockFetch({ ...validResponse, message_hash: 'not-hex' })

    await expect(generateClaimProof(validInput)).rejects.toThrow(
      'Invalid proof service response: invalid message_hash'
    )
  })
})
