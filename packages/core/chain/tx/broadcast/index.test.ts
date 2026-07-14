import { HttpResponseError } from '@vultisig/lib-utils/fetch/HttpResponseError'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  broadcastBittensorTx: vi.fn(),
  broadcastCardanoTx: vi.fn(),
  broadcastCosmosTx: vi.fn(),
  broadcastEvmTx: vi.fn(),
  broadcastPolkadotTx: vi.fn(),
  broadcastQbtcTx: vi.fn(),
  broadcastRippleTx: vi.fn(),
  broadcastSolanaTx: vi.fn(),
  broadcastSuiTx: vi.fn(),
  broadcastTonTx: vi.fn(),
  broadcastTronTx: vi.fn(),
  broadcastUtxoTx: vi.fn(),
}))

vi.mock('./resolvers/bittensor', () => ({ broadcastBittensorTx: mocks.broadcastBittensorTx }))
vi.mock('./resolvers/cardano', () => ({ broadcastCardanoTx: mocks.broadcastCardanoTx }))
vi.mock('./resolvers/cosmos', () => ({ broadcastCosmosTx: mocks.broadcastCosmosTx }))
vi.mock('./resolvers/evm', () => ({ broadcastEvmTx: mocks.broadcastEvmTx }))
vi.mock('./resolvers/polkadot', () => ({ broadcastPolkadotTx: mocks.broadcastPolkadotTx }))
vi.mock('./resolvers/qbtc', () => ({ broadcastQbtcTx: mocks.broadcastQbtcTx }))
vi.mock('./resolvers/ripple', () => ({ broadcastRippleTx: mocks.broadcastRippleTx }))
vi.mock('./resolvers/solana', () => ({ broadcastSolanaTx: mocks.broadcastSolanaTx }))
vi.mock('./resolvers/sui', () => ({ broadcastSuiTx: mocks.broadcastSuiTx }))
vi.mock('./resolvers/ton', () => ({ broadcastTonTx: mocks.broadcastTonTx }))
vi.mock('./resolvers/tron', () => ({ broadcastTronTx: mocks.broadcastTronTx }))
vi.mock('./resolvers/utxo', () => ({ broadcastUtxoTx: mocks.broadcastUtxoTx }))

import { Chain, OtherChain } from '../../Chain'
import { broadcastTx } from '.'
import { broadcastRetryMaxAttempts, isTransientBroadcastError } from './transientRetry'

describe('broadcastTx transient retry dispatcher', () => {
  const tx = { encoded: new Uint8Array([1, 2, 3]) } as any

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('retries transient transport errors for non-Solana/non-EVM resolvers', async () => {
    vi.useFakeTimers()
    mocks.broadcastCardanoTx.mockRejectedValueOnce(new Error('fetch failed')).mockResolvedValueOnce('hash')

    const promise = broadcastTx({ chain: OtherChain.Cardano, tx })

    await vi.advanceTimersByTimeAsync(250)
    await expect(promise).resolves.toBe('hash')

    expect(mocks.broadcastCardanoTx).toHaveBeenCalledTimes(2)
  })

  it('stops after the bounded retry budget for persistent transient errors', async () => {
    vi.useFakeTimers()
    const error = new Error('socket hang up')
    mocks.broadcastTonTx.mockRejectedValue(error)

    const promise = broadcastTx({ chain: OtherChain.Ton, tx })
    const assertion = expect(promise).rejects.toBe(error)

    await vi.advanceTimersByTimeAsync(750)
    await assertion

    expect(mocks.broadcastTonTx).toHaveBeenCalledTimes(broadcastRetryMaxAttempts)
  })

  it('does not retry node rejection errors', async () => {
    const error = new Error('BadInputsUTxO')
    mocks.broadcastCardanoTx.mockRejectedValue(error)

    await expect(broadcastTx({ chain: OtherChain.Cardano, tx })).rejects.toBe(error)

    expect(mocks.broadcastCardanoTx).toHaveBeenCalledTimes(1)
  })

  it('classifies structured HTTP 429 and 5xx errors as transient but not HTTP 400', () => {
    const httpError = (status: number) =>
      new HttpResponseError({
        message: `HTTP ${status}`,
        status,
        statusText: 'status',
        url: 'https://example.invalid',
        body: null,
      })

    expect(isTransientBroadcastError(httpError(429))).toBe(true)
    expect(isTransientBroadcastError(httpError(503))).toBe(true)
    expect(isTransientBroadcastError(httpError(400))).toBe(false)
  })

  it.each(['fetch failed', 'Failed to fetch', 'Network request failed'])(
    'classifies common fetch transport error %s as transient',
    message => {
      expect(isTransientBroadcastError(new Error(message))).toBe(true)
    }
  )

  it('does not add dispatcher retry on top of Solana or EVM resolver-owned retries', async () => {
    const error = new Error('fetch failed')
    mocks.broadcastSolanaTx.mockRejectedValueOnce(error)
    mocks.broadcastEvmTx.mockRejectedValueOnce(error)

    await expect(broadcastTx({ chain: Chain.Solana, tx })).rejects.toBe(error)
    await expect(broadcastTx({ chain: Chain.Ethereum, tx })).rejects.toBe(error)

    expect(mocks.broadcastSolanaTx).toHaveBeenCalledTimes(1)
    expect(mocks.broadcastEvmTx).toHaveBeenCalledTimes(1)
  })
})
