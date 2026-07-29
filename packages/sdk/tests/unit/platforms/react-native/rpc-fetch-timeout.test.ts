import { afterEach, describe, expect, it, vi } from 'vitest'

import { getSolanaBalance } from '../../../../src/platforms/react-native/chains/solana/rpc'
import { FetchTimeoutError } from '../../../../src/platforms/react-native/fetchWithTimeout'
import { jsonRpcCall, queryUrl } from '../../../../src/platforms/react-native/rpcFetch'

const neverRespondingFetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
  return new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal
    signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
})

describe('React Native fetch timeout and cancellation', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('bounds a wedged JSON-RPC request with a typed timeout', async () => {
    vi.stubGlobal('fetch', neverRespondingFetch)

    const error = await jsonRpcCall('http://127.0.0.1:1', 'eth_chainId', [], { timeoutMs: 10 }).catch(
      (cause: unknown) => cause
    )

    expect(error).toBeInstanceOf(FetchTimeoutError)
    expect(error).toMatchObject({ timeoutMs: 10, message: 'Request timeout after 10ms' })
    expect(neverRespondingFetch).toHaveBeenCalledTimes(1)
  })

  it('keeps the timeout active after headers while the JSON body is stalled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: () => new Promise(() => {}),
      }))
    )

    await expect(jsonRpcCall('http://127.0.0.1:1', 'eth_chainId', [], { timeoutMs: 10 })).rejects.toBeInstanceOf(
      FetchTimeoutError
    )
  })

  it('preserves the caller abort reason for REST queries', async () => {
    vi.stubGlobal('fetch', neverRespondingFetch)
    const controller = new AbortController()
    const reason = new Error('caller cancelled')
    const promise = queryUrl('http://127.0.0.1:1', { signal: controller.signal, timeoutMs: 10_000 })

    controller.abort(reason)

    await expect(promise).rejects.toBe(reason)
  })

  it('cancels a REST response whose body stalls after headers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: () => new Promise(() => {}),
      }))
    )
    const controller = new AbortController()
    const reason = new Error('cancel stalled body')
    const promise = queryUrl('http://127.0.0.1:1', { signal: controller.signal, timeoutMs: 10_000 })

    controller.abort(reason)

    await expect(promise).rejects.toBe(reason)
  })

  it('threads caller cancellation through Solana helpers', async () => {
    vi.stubGlobal('fetch', neverRespondingFetch)
    const controller = new AbortController()
    const reason = new Error('leave send screen')
    const promise = getSolanaBalance('11111111111111111111111111111111', 'http://127.0.0.1:1', {
      signal: controller.signal,
      timeoutMs: 10_000,
    })

    controller.abort(reason)

    await expect(promise).rejects.toBe(reason)
  })
})
