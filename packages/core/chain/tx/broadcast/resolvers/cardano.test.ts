import { encode } from 'cbor-x'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCardanoCurrentSlot: vi.fn(),
  getCardanoTxHash: vi.fn(),
  submitCardanoCbor: vi.fn(),
  verifyBroadcastByHash: vi.fn(),
}))

vi.mock('@vultisig/core-chain/chains/cardano/client/currentSlot', () => ({
  getCardanoCurrentSlot: mocks.getCardanoCurrentSlot,
}))

vi.mock('@vultisig/core-chain/chains/cardano/submit/submitCardanoCbor', () => ({
  submitCardanoCbor: mocks.submitCardanoCbor,
}))

vi.mock('@vultisig/core-chain/tx/hash/resolvers/cardano', () => ({
  getCardanoTxHash: mocks.getCardanoTxHash,
}))

vi.mock('../verifyBroadcastByHash', () => ({
  verifyBroadcastByHash: mocks.verifyBroadcastByHash,
}))

import { OtherChain } from '../../../Chain'
import { broadcastCardanoTx } from './cardano'

const txWithTtl = (ttl: number) =>
  ({
    encoded: encode([new Map([[3, ttl]]), new Map(), true, null]),
  }) as any

describe('broadcastCardanoTx', () => {
  const chain = OtherChain.Cardano

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('submits when the signed transaction TTL has enough broadcast margin', async () => {
    const tx = txWithTtl(1_000)
    mocks.getCardanoCurrentSlot.mockResolvedValue(939n)
    mocks.submitCardanoCbor.mockResolvedValue({ txHash: 'cardano-hash' })

    await expect(broadcastCardanoTx({ chain, tx })).resolves.toBe('cardano-hash')

    expect(mocks.submitCardanoCbor).toHaveBeenCalledWith(Buffer.from(tx.encoded).toString('hex'))
    expect(mocks.verifyBroadcastByHash).not.toHaveBeenCalled()
  })

  it('fails before submit when the signed transaction TTL is inside the safety margin', async () => {
    const tx = txWithTtl(1_000)
    mocks.getCardanoCurrentSlot.mockResolvedValue(940n)

    await expect(broadcastCardanoTx({ chain, tx })).rejects.toThrow(/TTL is expired or too close to expiry/)

    expect(mocks.submitCardanoCbor).not.toHaveBeenCalled()
    expect(mocks.verifyBroadcastByHash).not.toHaveBeenCalled()
  })

  it('fails before submit when the signed transaction does not expose a TTL', async () => {
    const tx = {
      encoded: encode([new Map(), new Map(), true, null]),
    } as any

    await expect(broadcastCardanoTx({ chain, tx })).rejects.toThrow(/Invalid Cardano transaction TTL/)

    expect(mocks.getCardanoCurrentSlot).not.toHaveBeenCalled()
    expect(mocks.submitCardanoCbor).not.toHaveBeenCalled()
  })
})
