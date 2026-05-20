import { afterEach, describe, expect, it, vi } from 'vitest'

import { checkProofServiceHealth, generateClaimProof } from './proofService'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

const mockFetch = (body: unknown, status = 200) => {
  globalThis.fetch = vi.fn(
    async () =>
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
    expect(globalThis.fetch).toHaveBeenCalledWith('http://localhost:8090/health')
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
    globalThis.fetch = vi.fn(async () => new Response('', { status: 503 })) as typeof fetch

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
    pub_key_hash_sha256: 'ee'.repeat(32),
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
    expect(result.pub_key_hash_sha256).toBe(validResponse.pub_key_hash_sha256)
    expect(result.claimer_address).toBe('qbtc1abc')
  })

  it('throws when pub_key_hash_sha256 is missing or wrong length', async () => {
    mockFetch({ ...validResponse, pub_key_hash_sha256: 'aa' })

    await expect(generateClaimProof(validInput)).rejects.toThrow(
      'Invalid proof service response: invalid pub_key_hash_sha256'
    )
  })

  it('throws on non-OK response', async () => {
    globalThis.fetch = vi.fn(async () => new Response('proof verification failed', { status: 400 })) as typeof fetch

    await expect(generateClaimProof(validInput)).rejects.toThrow('Proof service error (400): proof verification failed')
  })

  it('throws on invalid response fields', async () => {
    mockFetch({ ...validResponse, message_hash: 'not-hex' })

    await expect(generateClaimProof(validInput)).rejects.toThrow('Invalid proof service response: invalid message_hash')
  })

  it('omits broadcast from the request body when not requested', async () => {
    mockFetch(validResponse)

    await generateClaimProof(validInput)

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).not.toHaveProperty('broadcast')
  })

  it('forwards broadcast=true and the returned tx_hash', async () => {
    const validTxHash = 'AB'.repeat(32)
    mockFetch({ ...validResponse, tx_hash: validTxHash })

    const result = await generateClaimProof({ ...validInput, broadcast: true })

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.broadcast).toBe(true)
    expect(result.tx_hash).toBe(validTxHash)
  })

  it('throws when tx_hash is present but not 64 hex chars', async () => {
    mockFetch({ ...validResponse, tx_hash: 'too-short' })

    await expect(generateClaimProof({ ...validInput, broadcast: true })).rejects.toThrow(
      'Invalid proof service response: invalid tx_hash'
    )
  })
})
