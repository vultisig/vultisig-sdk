import { HttpResponseError } from '@vultisig/lib-utils/fetch/HttpResponseError'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
import { broadcastAccepted, BroadcastErrorCode, broadcastFailed, isRetryableBroadcastCause } from './resolver'

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
    const cause = new Error(`${kind} rejected`)
    const failed = broadcastFailed(cause, false)
    resolver.mockResolvedValue(failed)

    await expect(broadcastTx({ chain, tx })).resolves.toEqual(failed)
  })

  it('normalizes thrown transport failures instead of leaking them', async () => {
    const cause = new Error('ECONNRESET')
    resolver.mockRejectedValue(cause)

    await expect(broadcastTx({ chain, tx })).resolves.toEqual({
      status: 'failed',
      code: BroadcastErrorCode.Transport,
      retryable: true,
      cause,
    })
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

describe('broadcast result safety guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not classify an ambiguous local TypeError as a retryable transport failure', async () => {
    const cause = new TypeError('Cannot read properties of undefined')
    mocks.evm.mockRejectedValue(cause)

    await expect(broadcastTx({ chain: EvmChain.Ethereum, tx: {} as any })).resolves.toEqual({
      status: 'failed',
      code: BroadcastErrorCode.Rejected,
      retryable: false,
      cause,
    })
    expect(isRetryableBroadcastCause(new TypeError('fetch failed'))).toBe(true)
    expect(isRetryableBroadcastCause(new TypeError('Failed to fetch'))).toBe(true)
  })

  it('quarantines a contradictory result instead of treating it as shared contract data', async () => {
    const contradictory = {
      status: 'failed',
      code: BroadcastErrorCode.Rejected,
      retryable: true,
      cause: new Error('rejected'),
    }
    mocks.evm.mockResolvedValue(contradictory)

    await expect(broadcastTx({ chain: EvmChain.Ethereum, tx: {} as any })).resolves.toMatchObject({
      status: 'failed',
      code: BroadcastErrorCode.Rejected,
      retryable: false,
      details: { provider: contradictory },
    })
  })

  it('classifies structured transient HTTP failures even when their message is opaque', async () => {
    const cause = new HttpResponseError({
      message: 'Upstream unavailable',
      status: 503,
      statusText: 'Service Unavailable',
      url: 'https://example.test/broadcast',
      body: undefined,
    })

    expect(isRetryableBroadcastCause(cause)).toBe(true)
  })

  it('quarantines provider-native keys added to an otherwise valid result', async () => {
    const rawProviderResult = {
      status: 'accepted',
      finality: 'pending',
      txid: 'provider-native-hash',
    }
    mocks.evm.mockResolvedValue(rawProviderResult)

    await expect(broadcastTx({ chain: EvmChain.Ethereum, tx: {} as any })).resolves.toMatchObject({
      status: 'failed',
      code: BroadcastErrorCode.Rejected,
      retryable: false,
      details: { provider: rawProviderResult },
    })
  })
})
