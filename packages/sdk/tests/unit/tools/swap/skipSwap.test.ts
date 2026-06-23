import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildSkipAffiliates,
  quoteSkipRoute,
  resolveLuncFloorUsd,
  runSkipSwap,
  skipChainIdToChainName,
  type SkipSwapArgs,
} from '@/tools/swap/skip'

// OSMO (osmosis-1) → ATOM (cosmoshub-4) single-signature happy path.
const baseArgs: SkipSwapArgs = {
  fromAddress: 'osmo1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  toAddress: 'cosmos1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  sourceChainId: 'osmosis-1',
  sourceAssetDenom: 'uosmo',
  destChainId: 'cosmoshub-4',
  destAssetDenom: 'uatom',
  amountIn: '1000000',
}

const okRoute = {
  amount_in: '1000000',
  amount_out: '120000',
  estimated_amount_out: '120000',
  txs_required: 1,
  usd_amount_in: '0.45',
  usd_amount_out: '0.44',
  does_swap: true,
  swap_venue: { name: 'osmosis-poolmanager', chain_id: 'osmosis-1' },
  swap_venues: [{ name: 'osmosis-poolmanager', chain_id: 'osmosis-1' }],
  chain_ids: ['osmosis-1', 'cosmoshub-4'],
  required_chain_addresses: ['osmosis-1', 'cosmoshub-4'],
  estimated_route_duration_seconds: 60,
  operations: [{ swap: { swap_in: { swap_operations: [{}] } } }, { transfer: {} }],
  swap_price_impact_percent: '0.12',
}

const okMsgs = {
  txs: [
    {
      cosmos_tx: {
        chain_id: 'osmosis-1',
        signer_address: baseArgs.fromAddress,
        msgs: [{ msg: '{}', msg_type_url: '/ibc.applications.transfer.v1.MsgTransfer' }],
        memo: '',
      },
    },
  ],
  msgs: [],
  min_amount_out: '118800',
  route: okRoute,
}

function mockFetchSequence(responses: Array<{ status?: number; body: unknown }>) {
  let call = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const r = responses[Math.min(call, responses.length - 1)]!
      call += 1
      return {
        ok: (r.status ?? 200) >= 200 && (r.status ?? 200) < 300,
        status: r.status ?? 200,
        headers: { get: () => null },
        text: async () => JSON.stringify(r.body),
      } as unknown as Response
    })
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('skipChainIdToChainName', () => {
  it('maps known cosmos + evm chain ids and returns undefined for unsupported', () => {
    expect(skipChainIdToChainName('osmosis-1')).toBe('Osmosis')
    expect(skipChainIdToChainName('cosmoshub-4')).toBe('Cosmos')
    expect(skipChainIdToChainName('1')).toBe('Ethereum')
    expect(skipChainIdToChainName('agoric-3')).toBeUndefined()
    expect(skipChainIdToChainName('celestia')).toBeUndefined()
  })
})

describe('resolveLuncFloorUsd', () => {
  it('defaults on undefined/garbage, honours explicit values incl. 0', () => {
    expect(resolveLuncFloorUsd(undefined)).toBe(0.05)
    expect(resolveLuncFloorUsd(NaN)).toBe(0.05)
    expect(resolveLuncFloorUsd(-1)).toBe(0.05)
    expect(resolveLuncFloorUsd(0)).toBe(0)
    expect(resolveLuncFloorUsd(0.5)).toBe(0.5)
  })
})

describe('buildSkipAffiliates', () => {
  it('omits when no bps or no treasury address; builds for a known swap chain', () => {
    expect(buildSkipAffiliates('osmosis-1', undefined)).toBeUndefined()
    expect(buildSkipAffiliates('osmosis-1', 0)).toBeUndefined()
    expect(buildSkipAffiliates('unknown-chain', 50)).toBeUndefined()
    expect(buildSkipAffiliates('osmosis-1', 50)).toEqual({
      'osmosis-1': {
        affiliates: [{ basis_points_fee: '50', address: expect.stringMatching(/^osmo1/) }],
      },
    })
  })
})

describe('runSkipSwap input validation (no network)', () => {
  beforeEach(() => mockFetchSequence([{ body: okRoute }, { body: okMsgs }]))

  it('rejects an EVM-shaped address on a cosmos chain', async () => {
    const out = await runSkipSwap({
      ...baseArgs,
      fromAddress: '0x1234567890123456789012345678901234567890',
    })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.envelope.error).toBe('invalid_input')
  })

  it('rejects a validator operator (valoper) recipient — fund safety', async () => {
    const out = await runSkipSwap({
      ...baseArgs,
      toAddress: 'cosmosvaloper1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    })
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.envelope.error).toBe('invalid_input')
      expect(out.envelope.message).toMatch(/validator OPERATOR/)
    }
  })

  it('rejects amountIn <= 0', async () => {
    const out = await runSkipSwap({ ...baseArgs, amountIn: '0' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.envelope.error).toBe('invalid_input')
  })

  it('rejects out-of-range slippage', async () => {
    const out = await runSkipSwap({ ...baseArgs, slippageTolerancePercent: 9 })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.envelope.error).toBe('invalid_input')
  })
})

describe('runSkipSwap happy path (mocked Skip)', () => {
  it('returns an unsigned single-tx cosmos envelope with quote + metadata', async () => {
    mockFetchSequence([{ body: okRoute }, { body: okMsgs }])
    const out = await runSkipSwap(baseArgs)
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.tx_type).toBe('skip_swap')
      expect(out.multi_tx).toBe(false)
      expect(out.tx_count).toBe(1)
      expect(out.unsigned_msgs).toHaveLength(1)
      expect(out.unsigned_msgs[0]!.signing_method).toBe('cosmos')
      expect(out.unsigned_msgs[0]!.chain_id).toBe('osmosis-1')
      expect(out.quote.min_amount_out).toBe('118800')
      expect(out.quote.route_description).toContain('osmosis-1 → cosmoshub-4')
      expect(out.metadata.skip_chain_path).toEqual(['osmosis-1', 'cosmoshub-4'])
    }
  })
})

describe('runSkipSwap fund-safety guards (mocked Skip)', () => {
  it('rejects multi-signature routes unless opted in', async () => {
    mockFetchSequence([{ body: { ...okRoute, txs_required: 2 } }])
    const out = await runSkipSwap(baseArgs)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.envelope.error).toBe('skip_multi_tx_route_rejected')
  })

  it('rejects routes that custody funds on an unsupported chain', async () => {
    mockFetchSequence([{ body: { ...okRoute, required_chain_addresses: ['osmosis-1', 'agoric-3', 'cosmoshub-4'] } }])
    const out = await runSkipSwap(baseArgs)
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.envelope.error).toBe('skip_unsupported_route_chain')
      expect(out.envelope.chain_id).toBe('agoric-3')
    }
  })

  it('surfaces a Skip "no routes" 200 message as a 404 envelope', async () => {
    mockFetchSequence([{ body: { message: 'no routes found', txs_required: 0 } }])
    const out = await runSkipSwap(baseArgs)
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.envelope.error).toBe('skip_api_error')
      expect(out.envelope.status).toBe(404)
    }
  })
})

describe('quoteSkipRoute (quote-only path)', () => {
  it('returns the raw route on success', async () => {
    mockFetchSequence([{ body: okRoute }])
    const route = await quoteSkipRoute(baseArgs)
    expect(route.txs_required).toBe(1)
    expect(route.estimated_amount_out).toBe('120000')
  })
})
