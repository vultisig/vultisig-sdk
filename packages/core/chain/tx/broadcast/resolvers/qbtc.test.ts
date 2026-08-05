import { afterEach, describe, expect, it, vi } from 'vitest'

import { Chain } from '../../../Chain'
import { DeliverTxFailedError } from '../transientRetry'

const { mockVerify } = vi.hoisted(() => ({ mockVerify: vi.fn(async () => {}) }))
vi.mock('../verifyBroadcastByHash', () => ({ verifyBroadcastByHash: mockVerify }))
vi.mock('@vultisig/core-chain/chains/cosmos/qbtc/tendermintRpcUrl', () => ({ qbtcRestUrl: 'https://qbtc.test' }))

import { broadcastQbtcTx } from './qbtc'

const tx = { serialized: JSON.stringify({ tx_bytes: 'AAA=' }) } as never

const jsonResponse = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => '' })

// method/url-dispatched fetch: POST /txs -> broadcast (CheckTx), GET /txs/{hash} -> inclusion poll.
const stubFetch = ({ checkTx, inclusion }: { checkTx: unknown; inclusion?: unknown | (() => never) }) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: { method?: string }) => {
      if (init?.method === 'POST') return jsonResponse(checkTx)
      if (typeof inclusion === 'function') return (inclusion as () => never)()
      return jsonResponse(inclusion)
    })
  )
}

describe('broadcastQbtcTx — DeliverTx false-success', () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('returns a failed result when CheckTx passes but DeliverTx fails (out-of-gas)', async () => {
    stubFetch({
      checkTx: { tx_response: { code: 0, txhash: 'ABC123' } },
      inclusion: { tx_response: { code: 11, raw_log: 'out of gas' } },
    })
    const result = await broadcastQbtcTx({ chain: Chain.QBTC, tx })
    expect(result).toMatchObject({ status: 'failed', retryable: false, cause: expect.any(DeliverTxFailedError) })
  })

  it('resolves cleanly when both CheckTx and DeliverTx succeed', async () => {
    stubFetch({
      checkTx: { tx_response: { code: 0, txhash: 'ABC123' } },
      inclusion: { tx_response: { code: 0 } },
    })
    await expect(broadcastQbtcTx({ chain: Chain.QBTC, tx })).resolves.toMatchObject({
      status: 'accepted',
      txHash: 'ABC123',
    })
    expect(mockVerify).not.toHaveBeenCalled()
  })

  it('does NOT silently succeed when tx_response is missing — verifies by hash instead', async () => {
    stubFetch({ checkTx: {} })
    await broadcastQbtcTx({ chain: Chain.QBTC, tx })
    expect(mockVerify).toHaveBeenCalledOnce()
  })

  it('returns a definitive failure when a missing CheckTx hash cannot be verified', async () => {
    const missingHash = new Error('QBTC broadcast: missing txhash on CheckTx response')
    stubFetch({ checkTx: { tx_response: { code: 0 } } })
    mockVerify.mockRejectedValueOnce(missingHash)

    await expect(broadcastQbtcTx({ chain: Chain.QBTC, tx })).resolves.toEqual({
      status: 'failed',
      code: 'BROADCAST_REJECTED',
      retryable: false,
      cause: missingHash,
    })
  })

  it('verifies by hash on a CheckTx rejection (non-zero code)', async () => {
    stubFetch({ checkTx: { tx_response: { code: 5, raw_log: 'insufficient funds' } } })
    await broadcastQbtcTx({ chain: Chain.QBTC, tx })
    expect(mockVerify).toHaveBeenCalledOnce()
  })

  it('leaves the tx in-flight (no throw) when inclusion cannot be confirmed', async () => {
    stubFetch({
      checkTx: { tx_response: { code: 0, txhash: 'ABC123' } },
      inclusion: () => {
        throw new Error('network down')
      },
    })
    await expect(broadcastQbtcTx({ chain: Chain.QBTC, tx })).resolves.toMatchObject({
      status: 'accepted',
      txHash: 'ABC123',
    })
    expect(mockVerify).not.toHaveBeenCalled()
  })
})
