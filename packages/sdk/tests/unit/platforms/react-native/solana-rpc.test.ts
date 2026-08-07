import base58 from 'bs58'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { deriveSolanaRawTxSignature } from '../../../../src/chains/solana/rawTx'
import { broadcastSolanaTx } from '../../../../src/platforms/react-native/chains/solana/rpc'

const RPC_URL = 'https://solana.example'
const signatureBytes = Uint8Array.from({ length: 64 }, (_, index) => index + 1)
const rawTxBytes = Uint8Array.from([1, ...signatureBytes, 0])
const RAW_TX = Buffer.from(rawTxBytes).toString('base64')
const SIGNATURE = base58.encode(signatureBytes)
const verificationDelaysMs = [500, 1000, 1500]

const rpcResponse = (result: unknown): Response =>
  new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), {
    status: 200,
  })

const rpcError = (message: string, data?: unknown): Response =>
  new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32002, message, data },
    }),
    { status: 200 }
  )

const mockFetchSequence = (...responses: Response[]): ReturnType<typeof vi.fn> => {
  const fetchMock = vi.fn()
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response)
  }
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const settleVerificationRetries = async () => {
  for (const delay of verificationDelaysMs) {
    await vi.advanceTimersByTimeAsync(delay)
  }
}

describe('React Native Solana broadcast guarantees', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns the deterministic primary signature after an ordinary send', async () => {
    const fetchMock = mockFetchSequence(rpcResponse(SIGNATURE))

    await expect(broadcastSolanaTx(RAW_TX, RPC_URL)).resolves.toBe(SIGNATURE)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'sendTransaction',
      params: [
        RAW_TX,
        {
          encoding: 'base64',
          skipPreflight: false,
          preflightCommitment: 'confirmed',
          maxRetries: 3,
        },
      ],
    })
  })

  it.each([null, {}, 'rpc-supplied-signature'])('rejects an invalid successful send result (%j)', async result => {
    mockFetchSequence(rpcResponse(result))

    await expect(broadcastSolanaTx(RAW_TX, RPC_URL)).rejects.toThrow('does not match the signed transaction')
  })

  it.each([
    ['message', rpcError('This transaction has already been processed')],
    ['structured error data', rpcError('Transaction simulation failed', { err: 'AlreadyProcessed' })],
  ])('treats AlreadyProcessed in %s as idempotent success', async (_source, response) => {
    const fetchMock = mockFetchSequence(response)

    await expect(broadcastSolanaTx(RAW_TX, RPC_URL)).resolves.toBe(SIGNATURE)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns the signature when status lookup confirms an ambiguous send', async () => {
    const fetchMock = mockFetchSequence(
      rpcError('request timed out'),
      rpcResponse({
        context: { slot: 42 },
        value: [{ err: null, confirmationStatus: 'processed' }],
      })
    )

    await expect(broadcastSolanaTx(RAW_TX, RPC_URL)).resolves.toBe(SIGNATURE)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string)).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'getSignatureStatuses',
      params: [[SIGNATURE], { searchTransactionHistory: true }],
    })
  })

  it('retries an initially unknown signature until RPC indexing catches up', async () => {
    vi.useFakeTimers()
    const fetchMock = mockFetchSequence(
      rpcError('request timed out'),
      rpcResponse({ context: { slot: 42 }, value: [null] }),
      rpcResponse({ context: { slot: 43 }, value: [{ err: null }] })
    )

    const result = broadcastSolanaTx(RAW_TX, RPC_URL)
    await vi.advanceTimersByTimeAsync(500)

    await expect(result).resolves.toBe(SIGNATURE)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('rethrows the original send error when the signature is unknown', async () => {
    vi.useFakeTimers()
    mockFetchSequence(
      rpcError('upstream rejected the transaction'),
      ...Array.from({ length: 4 }, () => rpcResponse({ context: { slot: 42 }, value: [null] }))
    )

    const result = broadcastSolanaTx(RAW_TX, RPC_URL)
    const rejection = expect(result).rejects.toThrow('upstream rejected the transaction')
    await settleVerificationRetries()

    await rejection
  })

  it('rethrows the original send error when the known signature failed on-chain', async () => {
    mockFetchSequence(
      rpcError('request timed out'),
      rpcResponse({
        context: { slot: 42 },
        value: [{ err: { InstructionError: [0, 'Custom'] } }],
      })
    )

    await expect(broadcastSolanaTx(RAW_TX, RPC_URL)).rejects.toThrow('request timed out')
  })

  it('rethrows the original send error when status verification is unavailable', async () => {
    vi.useFakeTimers()
    mockFetchSequence(
      rpcError('request timed out'),
      ...Array.from({ length: 4 }, () => rpcError('status endpoint unavailable'))
    )

    const result = broadcastSolanaTx(RAW_TX, RPC_URL)
    const rejection = expect(result).rejects.toThrow('request timed out')
    await settleVerificationRetries()

    await rejection
  })

  it('stops verification backoff when the caller aborts', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const fetchMock = mockFetchSequence(
      rpcError('request timed out'),
      rpcResponse({ context: { slot: 42 }, value: [null] })
    )

    const result = broadcastSolanaTx(RAW_TX, RPC_URL, { signal: controller.signal })
    const rejection = expect(result).rejects.toThrow('request timed out')
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()

    await rejection
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each([{}, { value: 'not-an-array' }, { value: [{}] }])(
    'preserves the original send error after malformed status result %j',
    async statusResult => {
      vi.useFakeTimers()
      mockFetchSequence(rpcError('request timed out'), ...Array.from({ length: 4 }, () => rpcResponse(statusResult)))

      const result = broadcastSolanaTx(RAW_TX, RPC_URL)
      const rejection = expect(result).rejects.toThrow('request timed out')
      await settleVerificationRetries()

      await rejection
    }
  )

  it('derives the same signature through the Hermes atob fallback', () => {
    vi.stubGlobal('Buffer', undefined)

    expect(deriveSolanaRawTxSignature(RAW_TX, 'base64')).toBe(SIGNATURE)
  })

  it('auto-detects a base58 transaction', () => {
    expect(deriveSolanaRawTxSignature(base58.encode(rawTxBytes))).toBe(SIGNATURE)
  })

  it('parses a multi-byte compact signature count', () => {
    const multisigTx = new Uint8Array(2 + 128 * 64)
    multisigTx.set([0x80, 0x01])
    multisigTx.set(signatureBytes, 2)

    expect(deriveSolanaRawTxSignature(base58.encode(multisigTx), 'base58')).toBe(SIGNATURE)
  })

  it('fails before network I/O when the raw transaction has no complete signature', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(broadcastSolanaTx(Buffer.from([1, 2, 3]).toString('base64'), RPC_URL)).rejects.toThrow(
      'does not contain a complete primary signature'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
