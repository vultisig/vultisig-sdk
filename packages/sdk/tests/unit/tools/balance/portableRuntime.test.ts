import { UtxoChain } from '@vultisig/core-chain/Chain'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FetchTimeoutError } from '../../../../src/platforms/react-native/fetchWithTimeout'
import { getBittensorBalance } from '../../../../src/tools/balance/bittensor'
import { getCosmosBalance } from '../../../../src/tools/balance/cosmos'
import { fetchJson } from '../../../../src/tools/balance/rpc'
import { getUtxoBalance } from '../../../../src/tools/balance/utxoBalance'
import { callYieldActionREST, callYieldMCP, getBalances } from '../../../../src/tools/defi/stakekit/stakekitApi'

const stalled = () => new Promise<never>(() => {})
const response = (status: number, body: unknown = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: vi.fn(async () => body),
  text: vi.fn(async () => JSON.stringify(body)),
})

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(undefined!)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('portable balance deadlines', () => {
  it('works without AbortSignal.timeout and retains request overrides', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(200, { value: '9' }) as unknown as Response)
    await expect(
      fetchJson('https://example.test', { method: 'test' }, { headers: { authorization: 'fixture' } })
    ).resolves.toEqual({ value: '9' })
    expect(fetch).toHaveBeenCalledWith(
      'https://example.test',
      expect.objectContaining({
        method: 'POST',
        body: '{"method":"test"}',
        headers: { authorization: 'fixture' },
        signal: expect.any(AbortSignal),
      })
    )
    expect(vi.getTimerCount()).toBe(0)
  })
  it.each([200, 400])('bounds a stalled %i body without retrying the deadline', async status => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({ ...response(status), json: stalled, text: stalled } as unknown as Response)
    const result = expect(fetchJson('https://example.test')).rejects.toBeInstanceOf(FetchTimeoutError)
    await vi.advanceTimersByTimeAsync(15_000)
    await result
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
  it.each([429, 503])('retries %i without waiting for its stalled body', async status => {
    const body = vi.fn(stalled)
    const cancel = vi.fn(async () => {})
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ...response(status), body: { cancel }, json: body, text: body } as unknown as Response)
      .mockResolvedValueOnce(response(200, { ok: true }) as unknown as Response)
    const result = fetchJson('https://example.test')
    await vi.advanceTimersByTimeAsync(1000)
    await expect(result).resolves.toEqual({ ok: true })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(body).not.toHaveBeenCalled()
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('preserves caller cancellation during body consumption and removes its listener', async () => {
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({ ...response(200), json: stalled } as unknown as Response)
    const error = new Error('caller stopped')
    const result = expect(fetchJson('https://example.test', undefined, { signal: controller.signal })).rejects.toBe(
      error
    )
    await vi.advanceTimersByTimeAsync(1)
    controller.abort(error)
    await result
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(vi.getTimerCount()).toBe(0)
  })
  it('cancels retry backoff and never starts another request', async () => {
    const controller = new AbortController()
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(503) as unknown as Response)
    const error = new Error('stop retry')
    const result = expect(fetchJson('https://example.test', undefined, { signal: controller.signal })).rejects.toBe(
      error
    )
    await vi.advanceTimersByTimeAsync(10)
    controller.abort(error)
    await result
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('cancels each Bittensor endpoint before moving to the next', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(stalled)
    const result = expect(getBittensorBalance('5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY')).rejects.toThrow(
      /unreachable/
    )
    await vi.advanceTimersByTimeAsync(60_000)
    await result
    expect(fetch).toHaveBeenCalledTimes(3)
    for (const [, init] of fetch.mock.calls) expect(init?.signal?.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('retains Cosmos timeout retries, then succeeds without native timeout support', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ...response(200), json: stalled } as unknown as Response)
      .mockResolvedValueOnce(response(200, { balances: [] }) as unknown as Response)
    const result = getCosmosBalance('Cosmos', 'cosmos1fixture')
    await vi.advanceTimersByTimeAsync(15_300)
    await expect(result).resolves.toMatchObject({ nativeRaw: '0' })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('bounds raw UTXO body reads', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ...response(200), text: stalled } as unknown as Response)
    const result = expect(getUtxoBalance(UtxoChain.Bitcoin, 'fixture', { timeoutMs: 100 })).rejects.toBeInstanceOf(
      FetchTimeoutError
    )
    await vi.advanceTimersByTimeAsync(100)
    await result
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('portable StakeKit deadlines', () => {
  it.each([
    ['balances', () => getBalances('fixture', 'ethereum', undefined, ['fixture-yield']), 15_000],
    ['MCP', () => callYieldMCP('fixture', {}), 30_000],
    ['REST', () => callYieldActionREST('fixture', 'enter', {}), 30_000],
  ] as const)('bounds %s success and error bodies', async (_name, call, timeout) => {
    for (const status of [200, 500]) {
      const fetch = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue({ ...response(status), json: stalled, text: stalled } as unknown as Response)
      const result = expect(call()).rejects.toBeInstanceOf(FetchTimeoutError)
      await vi.advanceTimersByTimeAsync(timeout)
      await result
      expect(fetch.mock.lastCall?.[1]?.signal?.aborted).toBe(true)
      expect(vi.getTimerCount()).toBe(0)
    }
  })
  it('retains 403 balance semantics and cleans the timer', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(403) as unknown as Response)
    await expect(getBalances('fixture', 'ethereum', undefined, ['fixture-yield'])).resolves.toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })
})
