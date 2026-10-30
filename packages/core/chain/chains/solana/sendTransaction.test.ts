import { HttpResponseError } from '@vultisig/lib-utils/fetch/HttpResponseError'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { solanaRpcUrl } from './client'
import { sendSolanaTransaction, SolanaSendTransactionError } from './sendTransaction'

const signature = '2gB3ifNe2kSoJEYoVY7T4vw2z5ci9nL6WcQQuCC2ozCiURBwSfC9uGcCq9CS2pAzX7ed1xwyS4434BmSg2WhrZ7j'
const rawTransaction = new Uint8Array([1, 2, 3, 4])

// Verbatim preflight rejection, as returned by both api.mainnet-beta.solana.com
// and the Vultisig proxy (captured 2026-10-27).
const blockhashNotFound = {
  code: -32002,
  message: 'Transaction simulation failed',
  data: { err: 'BlockhashNotFound', logs: [] },
}

describe('sendSolanaTransaction', () => {
  const fetchMock = vi.fn()

  const reply = (body: unknown, init?: ResponseInit) => fetchMock.mockResolvedValue(Response.json(body, init))

  const sentRequest = () => {
    const [url, init] = fetchMock.mock.calls[0]
    return { url, body: JSON.parse(init.body) }
  }

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends with preflight at confirmed commitment, as Connection.sendRawTransaction does', async () => {
    reply({ jsonrpc: '2.0', id: 1, result: signature })

    await expect(sendSolanaTransaction({ rawTransaction, skipPreflight: false, maxRetries: 0 })).resolves.toBe(
      signature
    )

    expect(sentRequest()).toEqual({
      url: solanaRpcUrl,
      body: {
        jsonrpc: '2.0',
        id: 1,
        method: 'sendTransaction',
        params: ['AQIDBA==', { encoding: 'base64', maxRetries: 0, preflightCommitment: 'confirmed' }],
      },
    })
  })

  it('switches to processed commitment when preflight is skipped, as web3.js does', async () => {
    reply({ jsonrpc: '2.0', id: 1, result: signature })

    await sendSolanaTransaction({ rawTransaction, skipPreflight: true, maxRetries: 3 })

    expect(sentRequest().body.params[1]).toEqual({
      encoding: 'base64',
      maxRetries: 3,
      skipPreflight: true,
      preflightCommitment: 'processed',
    })
  })

  it('names the node verdict from data.err in the message', async () => {
    reply({ jsonrpc: '2.0', id: 1, error: blockhashNotFound })

    const error = await sendSolanaTransaction({ rawTransaction, skipPreflight: false, maxRetries: 0 }).catch(e => e)

    expect(error).toBeInstanceOf(SolanaSendTransactionError)
    expect(error.message).toBe('Transaction simulation failed: BlockhashNotFound')
    expect(error.logs).toEqual([])
  })

  // A program writes its own logs, so they must never reach the text the
  // broadcast resolver classifies on.
  it('keeps program logs out of the message and serializes a structured verdict', async () => {
    const logs = [
      'Program 11111111111111111111111111111111 invoke [1]',
      'Program log: Blockhash not found; this transaction has already been processed',
      'Program 11111111111111111111111111111111 failed: custom program error: 0x1',
    ]
    reply({
      jsonrpc: '2.0',
      id: 1,
      error: { ...blockhashNotFound, data: { err: { InstructionError: [0, { Custom: 1 }] }, logs } },
    })

    const error = await sendSolanaTransaction({ rawTransaction, skipPreflight: false, maxRetries: 0 }).catch(e => e)

    expect(error.message).toBe('Transaction simulation failed: {"InstructionError":[0,{"Custom":1}]}')
    expect(error.logs).toEqual(logs)
  })

  it('keeps the message as-is for a JSON-RPC error without a verdict', async () => {
    reply({ jsonrpc: '2.0', id: 1, error: { code: -32005, message: 'Node is behind by 42 slots' } })

    const error = await sendSolanaTransaction({ rawTransaction, skipPreflight: true, maxRetries: 0 }).catch(e => e)

    expect(error).toBeInstanceOf(SolanaSendTransactionError)
    expect(error.message).toBe('Node is behind by 42 slots')
    expect(error.logs).toEqual([])
  })

  it('reports an HTTP failure with its status, so the caller can tell transport from rejection', async () => {
    reply({ message: 'upstream unavailable' }, { status: 503, statusText: 'Service Unavailable' })

    const error = await sendSolanaTransaction({ rawTransaction, skipPreflight: false, maxRetries: 0 }).catch(e => e)

    expect(error).toBeInstanceOf(HttpResponseError)
    expect(error.status).toBe(503)
  })

  it('rejects a response with neither a signature nor an error', async () => {
    reply({ jsonrpc: '2.0', id: 1 })

    await expect(sendSolanaTransaction({ rawTransaction, skipPreflight: false, maxRetries: 0 })).rejects.toThrow(
      'neither a signature nor an error'
    )
  })
})
