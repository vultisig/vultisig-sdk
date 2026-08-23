import { HttpResponseError } from '@vultisig/lib-utils/fetch/HttpResponseError'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  bittensor: vi.fn(),
  cardano: vi.fn(),
  cosmos: vi.fn(),
  evm: vi.fn(),
  polkadot: vi.fn(),
  qbtc: vi.fn(),
  ripple: vi.fn(),
  solana: vi.fn(),
  sui: vi.fn(),
  ton: vi.fn(),
  tron: vi.fn(),
  utxo: vi.fn(),
}))

vi.mock('./resolvers/bittensor', () => ({ broadcastBittensorTx: mocks.bittensor }))
vi.mock('./resolvers/cardano', () => ({ broadcastCardanoTx: mocks.cardano }))
vi.mock('./resolvers/cosmos', () => ({ broadcastCosmosTx: mocks.cosmos }))
vi.mock('./resolvers/evm', () => ({ broadcastEvmTx: mocks.evm }))
vi.mock('./resolvers/polkadot', () => ({ broadcastPolkadotTx: mocks.polkadot }))
vi.mock('./resolvers/qbtc', () => ({ broadcastQbtcTx: mocks.qbtc }))
vi.mock('./resolvers/ripple', () => ({ broadcastRippleTx: mocks.ripple }))
vi.mock('./resolvers/solana', () => ({ broadcastSolanaTx: mocks.solana }))
vi.mock('./resolvers/sui', () => ({ broadcastSuiTx: mocks.sui }))
vi.mock('./resolvers/ton', () => ({ broadcastTonTx: mocks.ton }))
vi.mock('./resolvers/tron', () => ({ broadcastTronTx: mocks.tron }))
vi.mock('./resolvers/utxo', () => ({ broadcastUtxoTx: mocks.utxo }))

import { Chain, CosmosChain, EvmChain, OtherChain, UtxoChain } from '../../Chain'
import type { ChainKind } from '../../ChainKind'
import { broadcastTx } from '.'
import { CosmosSequenceMismatchError } from './cosmosSequenceMismatch'
import { broadcastAccepted, BroadcastErrorCode, broadcastFailed, isRetryableBroadcastCause } from './resolver'
import { broadcastRetryMaxAttempts, isTransientBroadcastError } from './transientRetry'

const cases = {
  bittensor: { chain: OtherChain.Bittensor, resolver: mocks.bittensor },
  cardano: { chain: OtherChain.Cardano, resolver: mocks.cardano },
  cosmos: { chain: CosmosChain.Cosmos, resolver: mocks.cosmos },
  evm: { chain: EvmChain.Ethereum, resolver: mocks.evm },
  polkadot: { chain: OtherChain.Polkadot, resolver: mocks.polkadot },
  qbtc: { chain: OtherChain.QBTC, resolver: mocks.qbtc },
  ripple: { chain: OtherChain.Ripple, resolver: mocks.ripple },
  solana: { chain: OtherChain.Solana, resolver: mocks.solana },
  sui: { chain: OtherChain.Sui, resolver: mocks.sui },
  ton: { chain: OtherChain.Ton, resolver: mocks.ton },
  tron: { chain: OtherChain.Tron, resolver: mocks.tron },
  utxo: { chain: UtxoChain.Bitcoin, resolver: mocks.utxo },
} satisfies Record<ChainKind, { chain: Chain; resolver: ReturnType<typeof vi.fn> }>

describe.each(Object.entries(cases))('broadcastTx %s adapter contract', (kind, { chain, resolver }) => {
  const tx = {} as any

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the shared accepted result', async () => {
    const accepted = broadcastAccepted(`${kind}-hash`)
    resolver.mockResolvedValue(accepted)

    await expect(broadcastTx({ chain, tx })).resolves.toEqual(accepted)
    expect(resolver).toHaveBeenCalledWith({ chain, tx })
  })

  it('returns the shared definitive failure result', async () => {
    const failed = broadcastFailed(new Error(`${kind} rejected`), false)
    resolver.mockResolvedValue(failed)

    await expect(broadcastTx({ chain, tx })).resolves.toEqual(failed)
  })

  it('quarantines raw provider responses under namespaced details', async () => {
    const rawProviderResponse = { txid: `${kind}-raw`, result: true }
    resolver.mockResolvedValue(rawProviderResponse)

    await expect(broadcastTx({ chain, tx })).resolves.toEqual({
      status: 'failed',
      code: BroadcastErrorCode.Rejected,
      retryable: false,
      cause: expect.objectContaining({ message: 'Broadcast resolver returned an invalid result' }),
      details: { provider: rawProviderResponse },
    })
  })
})

describe('broadcastTx transient retry dispatcher', () => {
  const tx = { encoded: new Uint8Array([1, 2, 3]) } as any

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('retries transient result failures for non-Solana/non-EVM resolvers', async () => {
    vi.useFakeTimers()
    const cause = new Error('fetch failed')
    mocks.cardano.mockResolvedValueOnce(broadcastFailed(cause, true)).mockResolvedValueOnce(broadcastAccepted('hash'))

    const promise = broadcastTx({ chain: OtherChain.Cardano, tx })
    await vi.advanceTimersByTimeAsync(250)

    await expect(promise).resolves.toEqual(broadcastAccepted('hash'))
    expect(mocks.cardano).toHaveBeenCalledTimes(2)
  })

  it('stops after the bounded retry budget and returns the last transient failure', async () => {
    vi.useFakeTimers()
    const failed = broadcastFailed(new Error('socket hang up'), true)
    mocks.ton.mockResolvedValue(failed)

    const promise = broadcastTx({ chain: OtherChain.Ton, tx })
    await vi.advanceTimersByTimeAsync(750)

    await expect(promise).resolves.toEqual(failed)
    expect(mocks.ton).toHaveBeenCalledTimes(broadcastRetryMaxAttempts)
  })

  it('does not retry node rejection results', async () => {
    const failed = broadcastFailed(new Error('BadInputsUTxO'), false)
    mocks.cardano.mockResolvedValue(failed)

    await expect(broadcastTx({ chain: OtherChain.Cardano, tx })).resolves.toEqual(failed)
    expect(mocks.cardano).toHaveBeenCalledTimes(1)
  })

  it('does not add dispatcher retry on top of resolver-owned retry', async () => {
    const failed = broadcastFailed(new Error('fetch failed'), true)
    mocks.solana.mockResolvedValueOnce(failed)
    mocks.evm.mockResolvedValueOnce(failed)

    await expect(broadcastTx({ chain: Chain.Solana, tx })).resolves.toEqual(failed)
    await expect(broadcastTx({ chain: Chain.Ethereum, tx })).resolves.toEqual(failed)
    expect(mocks.solana).toHaveBeenCalledTimes(1)
    expect(mocks.evm).toHaveBeenCalledTimes(1)
  })
})

describe('broadcastTx strategy guard', () => {
  const tx = {} as any

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    [EvmChain.Polygon, mocks.evm],
    [OtherChain.Cardano, mocks.cardano],
  ] as const)(
    'rejects raced-public-rpc for non-Ethereum chain %s before resolver dispatch',
    async (chain, resolver) => {
      // @ts-expect-error raced-public-rpc is restricted to Ethereum at the public type boundary.
      const result = await broadcastTx({ chain, tx, strategy: 'raced-public-rpc' })

      expect(result).toMatchObject({
        status: 'failed',
        code: BroadcastErrorCode.Rejected,
        retryable: false,
        cause: expect.objectContaining({
          message: 'raced-public-rpc broadcast strategy is only supported for Ethereum',
        }),
      })
      expect(resolver).not.toHaveBeenCalled()
    }
  )

  it('dispatches raced-public-rpc for Ethereum', async () => {
    const accepted = broadcastAccepted('ethereum-hash')
    mocks.evm.mockResolvedValue(accepted)

    await expect(broadcastTx({ chain: EvmChain.Ethereum, tx, strategy: 'raced-public-rpc' })).resolves.toEqual(accepted)
    expect(mocks.evm).toHaveBeenCalledWith({ chain: EvmChain.Ethereum, tx, strategy: 'raced-public-rpc' })
  })
})

describe('broadcast result safety guards', () => {
  const tx = {} as any

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('normalizes thrown transport failures instead of leaking them', async () => {
    const cause = new Error('ECONNRESET')
    mocks.evm.mockRejectedValue(cause)

    await expect(broadcastTx({ chain: EvmChain.Ethereum, tx: {} as any })).resolves.toEqual({
      status: 'failed',
      code: BroadcastErrorCode.Transport,
      retryable: true,
      cause,
    })
  })

  it('does not classify an ambiguous local TypeError as retryable', async () => {
    const cause = new TypeError('Cannot read properties of undefined')
    mocks.evm.mockRejectedValue(cause)

    await expect(broadcastTx({ chain: EvmChain.Ethereum, tx: {} as any })).resolves.toEqual({
      status: 'failed',
      code: BroadcastErrorCode.Rejected,
      retryable: false,
      cause,
    })
  })

  it('quarantines contradictory and provider-native result shapes', async () => {
    const contradictory = {
      status: 'failed',
      code: BroadcastErrorCode.Rejected,
      retryable: true,
      cause: new Error('rejected'),
    }
    mocks.evm.mockResolvedValueOnce(contradictory)

    await expect(broadcastTx({ chain: EvmChain.Ethereum, tx: {} as any })).resolves.toMatchObject({
      status: 'failed',
      code: BroadcastErrorCode.Rejected,
      retryable: false,
      details: { provider: contradictory },
    })

    const rawProviderResult = { status: 'accepted', finality: 'pending', txid: 'provider-native-hash' }
    mocks.evm.mockResolvedValueOnce(rawProviderResult)
    await expect(broadcastTx({ chain: EvmChain.Ethereum, tx: {} as any })).resolves.toMatchObject({
      status: 'failed',
      details: { provider: rawProviderResult },
    })
  })

  it('classifies structured HTTP and common fetch transport failures', () => {
    const httpError = (status: number) =>
      new HttpResponseError({
        message: 'opaque body',
        status,
        statusText: 'status',
        url: 'https://example.invalid',
        body: null,
      })

    expect(isRetryableBroadcastCause(httpError(408))).toBe(true)
    expect(isRetryableBroadcastCause(httpError(429))).toBe(true)
    expect(isRetryableBroadcastCause(httpError(503))).toBe(true)
    expect(isRetryableBroadcastCause(httpError(400))).toBe(false)
    expect(isRetryableBroadcastCause(httpError(600))).toBe(false)
    for (const message of ['fetch failed', 'Failed to fetch', 'Network request failed', 'Load failed']) {
      expect(isTransientBroadcastError(new TypeError(message))).toBe(true)
    }
  })

  it('terminates when an error cause chain is cyclic', () => {
    const error = new Error('deterministic rejection')
    error.cause = error

    expect(isTransientBroadcastError(error)).toBe(false)
  })

  it('does not retry a stale Cosmos sequence that requires re-signing', async () => {
    const error = new CosmosSequenceMismatchError({
      expectedSequence: 255n,
      signedSequence: 254n,
    })
    const failed = broadcastFailed(error, false)
    mocks.cosmos.mockResolvedValue(failed)

    await expect(broadcastTx({ chain: Chain.Cosmos, tx })).resolves.toEqual(failed)

    expect(mocks.cosmos).toHaveBeenCalledTimes(1)
  })

  it('retries a future Cosmos sequence after its predecessor may have landed', async () => {
    vi.useFakeTimers()
    const error = new CosmosSequenceMismatchError({
      expectedSequence: 254n,
      signedSequence: 255n,
    })
    mocks.cosmos.mockResolvedValueOnce(broadcastFailed(error, true)).mockResolvedValueOnce(broadcastAccepted())

    const promise = broadcastTx({ chain: Chain.Cosmos, tx })

    await vi.advanceTimersByTimeAsync(250)
    await expect(promise).resolves.toEqual(broadcastAccepted())
    expect(mocks.cosmos).toHaveBeenCalledTimes(2)
  })
})
