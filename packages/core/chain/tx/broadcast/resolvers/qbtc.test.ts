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

  it('throws DeliverTxFailedError when CheckTx passes but DeliverTx fails (out-of-gas)', async () => {
    stubFetch({
      checkTx: { tx_response: { code: 0, txhash: 'ABC123' } },
      inclusion: { tx_response: { code: 11, raw_log: 'out of gas' } },
    })
    await expect(broadcastQbtcTx({ chain: Chain.QBTC, tx })).rejects.toBeInstanceOf(DeliverTxFailedError)
  })

  it('resolves cleanly when both CheckTx and DeliverTx succeed', async () => {
    stubFetch({
      checkTx: { tx_response: { code: 0, txhash: 'ABC123' } },
      inclusion: { tx_response: { code: 0 } },
    })
    await expect(broadcastQbtcTx({ chain: Chain.QBTC, tx })).resolves.toBeUndefined()
    expect(mockVerify).not.toHaveBeenCalled()
  })

  it('does NOT silently succeed when tx_response is missing — verifies by hash instead', async () => {
    stubFetch({ checkTx: {} })
    await broadcastQbtcTx({ chain: Chain.QBTC, tx })
    expect(mockVerify).toHaveBeenCalledOnce()
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
    await expect(broadcastQbtcTx({ chain: Chain.QBTC, tx })).resolves.toBeUndefined()
    expect(mockVerify).not.toHaveBeenCalled()
  })
})
