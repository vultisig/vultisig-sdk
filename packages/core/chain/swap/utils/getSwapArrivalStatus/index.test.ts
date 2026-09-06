import { describe, expect, it, vi } from 'vitest'

import fixtures from './fixtures.json'
import { getSwapArrivalStatus, isSwapArrivalStatusTerminal, SwapArrivalStatusRequestError } from './index'

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

describe('getSwapArrivalStatus', () => {
  describe('THORChain and MayaChain', () => {
    it('combines THORNode stages with a pending Midgard action', async () => {
      const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        return url.includes('/tx/status/')
          ? jsonResponse(fixtures.thorchainNodePending)
          : jsonResponse(fixtures.thorchainMidgardPending)
      }) as typeof fetch

      await expect(
        getSwapArrivalStatus({
          provider: 'thorchain',
          txHash: ' THOR-SOURCE ',
          hosts: {
            thorchainNode: 'https://node.example/thorchain/',
            thorchainMidgard: 'https://midgard.example/',
          },
          fetchImpl,
        })
      ).resolves.toMatchObject({
        provider: 'thorchain',
        txHash: 'THOR-SOURCE',
        status: 'pending',
        stage: 'swapping',
      })

      expect(fetchImpl).toHaveBeenCalledWith('https://node.example/thorchain/tx/status/THOR-SOURCE', expect.any(Object))
      expect(fetchImpl).toHaveBeenCalledWith('https://midgard.example/v2/actions?txid=THOR-SOURCE', expect.any(Object))
    })

    it('normalizes a completed THORChain refund and preserves its reason and outbound hash', async () => {
      const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
        String(input).includes('/v2/actions') ? jsonResponse(fixtures.thorchainMidgardRefunded) : jsonResponse({}, 404)
      ) as typeof fetch

      await expect(
        getSwapArrivalStatus({ provider: 'thorchain', txHash: 'THOR-REFUND-SOURCE', fetchImpl })
      ).resolves.toEqual({
        provider: 'thorchain',
        txHash: 'THOR-REFUND-SOURCE',
        status: 'refunded',
        stage: 'refunded',
        destinationTxHash: 'THOR-REFUND-OUT',
        message: 'emit asset less than price limit',
      })
    })

    it('normalizes a successful MayaChain action with its destination hash', async () => {
      const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
        String(input).includes('/v2/actions') ? jsonResponse(fixtures.mayachainMidgardSuccess) : jsonResponse({}, 404)
      ) as typeof fetch

      await expect(getSwapArrivalStatus({ provider: 'mayachain', txHash: 'MAYA-SOURCE', fetchImpl })).resolves.toEqual({
        provider: 'mayachain',
        txHash: 'MAYA-SOURCE',
        status: 'success',
        stage: 'complete',
        destinationTxHash: 'MAYA-DESTINATION',
      })
    })

    it('uses an empty Midgard result as authoritative not-found evidence', async () => {
      const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
        String(input).includes('/v2/actions') ? jsonResponse({ count: '0', actions: [] }) : jsonResponse({}, 404)
      ) as typeof fetch

      const result = await getSwapArrivalStatus({ provider: 'thorchain', txHash: 'UNKNOWN', fetchImpl })

      expect(result).toEqual({
        provider: 'thorchain',
        txHash: 'UNKNOWN',
        status: 'not_found',
        stage: 'not_found',
      })
      expect(isSwapArrivalStatusTerminal(result)).toBe(false)
    })

    it('keeps a THORNode-completed outbound pending when Midgard is unavailable', async () => {
      const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
        String(input).includes('/v2/actions')
          ? jsonResponse({ message: 'unavailable' }, 502)
          : jsonResponse(fixtures.thorchainNodeCompleteWithOutbound)
      ) as typeof fetch

      const result = await getSwapArrivalStatus({ provider: 'thorchain', txHash: 'THOR-REFUND-SOURCE', fetchImpl })

      expect(result).toEqual({
        provider: 'thorchain',
        txHash: 'THOR-REFUND-SOURCE',
        status: 'pending',
        stage: 'outbound',
        destinationTxHash: 'THOR-REAL-OUT',
      })
      expect(isSwapArrivalStatusTerminal(result)).toBe(false)
    })

    it('throws on a malformed/missing Midgard action status instead of reporting a terminal swap error', async () => {
      const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
        String(input).includes('/v2/actions')
          ? jsonResponse(fixtures.thorchainMidgardMalformedSwapStatus)
          : jsonResponse({}, 404)
      ) as typeof fetch

      await expect(getSwapArrivalStatus({ provider: 'thorchain', txHash: 'THOR-SOURCE', fetchImpl })).rejects.toThrow(
        SwapArrivalStatusRequestError
      )
    })

    it('reports a refund when THORNode planned_out_txs marks the outbound as a refund, even without Midgard', async () => {
      const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
        String(input).includes('/v2/actions')
          ? jsonResponse({ message: 'unavailable' }, 502)
          : jsonResponse(fixtures.thorchainNodeCompleteWithPlannedRefund)
      ) as typeof fetch

      const result = await getSwapArrivalStatus({ provider: 'thorchain', txHash: 'THOR-REFUND-SOURCE', fetchImpl })

      expect(result).toEqual({
        provider: 'thorchain',
        txHash: 'THOR-REFUND-SOURCE',
        status: 'refunded',
        stage: 'refunded',
        destinationTxHash: 'THOR-REAL-OUT',
      })
      expect(isSwapArrivalStatusTerminal(result)).toBe(true)
    })

    it('reports success when THORNode planned_out_txs marks the outbound as the swap output, even without Midgard', async () => {
      const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
        String(input).includes('/v2/actions')
          ? jsonResponse({ message: 'unavailable' }, 502)
          : jsonResponse(fixtures.thorchainNodeCompleteWithPlannedSwapOutput)
      ) as typeof fetch

      const result = await getSwapArrivalStatus({ provider: 'thorchain', txHash: 'THOR-SUCCESS-SOURCE', fetchImpl })

      expect(result).toEqual({
        provider: 'thorchain',
        txHash: 'THOR-SUCCESS-SOURCE',
        status: 'success',
        stage: 'complete',
        destinationTxHash: 'THOR-REAL-OUT',
      })
      expect(isSwapArrivalStatusTerminal(result)).toBe(true)
    })

    it('throws when both THORChain sources are unavailable instead of reporting a terminal swap error', async () => {
      const fetchImpl = vi.fn(async () => jsonResponse({ message: 'unavailable' }, 503)) as typeof fetch

      await expect(getSwapArrivalStatus({ provider: 'thorchain', txHash: 'TX', fetchImpl })).rejects.toBeInstanceOf(
        SwapArrivalStatusRequestError
      )
    })

    it('throws on malformed successful responses instead of misreporting not_found', async () => {
      const fetchImpl = vi.fn(async () => jsonResponse({ unexpected: true })) as typeof fetch

      await expect(getSwapArrivalStatus({ provider: 'mayachain', txHash: 'TX', fetchImpl })).rejects.toThrow(
        'unknown transaction status response'
      )
    })

    it('rejects malformed Midgard action entries instead of treating them as an empty result', async () => {
      const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
        String(input).includes('/v2/actions') ? jsonResponse({ actions: [null] }) : jsonResponse({}, 404)
      ) as typeof fetch

      await expect(getSwapArrivalStatus({ provider: 'thorchain', txHash: 'TX', fetchImpl })).rejects.toThrow(
        'unknown actions response'
      )
    })

    it('rejects a mixed Midgard action array instead of accepting its valid prefix', async () => {
      const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
        String(input).includes('/v2/actions')
          ? jsonResponse({ actions: [...fixtures.mayachainMidgardSuccess.actions, null] })
          : jsonResponse({}, 404)
      ) as typeof fetch

      await expect(getSwapArrivalStatus({ provider: 'mayachain', txHash: 'MAYA-SOURCE', fetchImpl })).rejects.toThrow(
        'unknown actions response'
      )
    })
  })

  describe('Skip', () => {
    it('normalizes a completed multi-hop transfer and extracts its destination hash', async () => {
      const fetchImpl = vi.fn(async () => jsonResponse(fixtures.skipCompleted)) as typeof fetch

      await expect(
        getSwapArrivalStatus({ provider: 'skip', txHash: 'SKIP-SOURCE', chainId: 'cosmoshub-4', fetchImpl })
      ).resolves.toEqual({
        provider: 'skip',
        txHash: 'SKIP-SOURCE',
        status: 'success',
        stage: 'complete',
        destinationTxHash: 'SKIP-DESTINATION',
      })

      expect(fetchImpl).toHaveBeenCalledWith(
        'https://api.skip.build/v2/tx/status?tx_hash=SKIP-SOURCE&chain_id=cosmoshub-4',
        expect.any(Object)
      )
    })

    it('classifies a completed error as refunded only when assets were released on the source chain', async () => {
      const fetchImpl = vi.fn(async () => jsonResponse(fixtures.skipRefunded)) as typeof fetch

      await expect(
        getSwapArrivalStatus({ provider: 'skip', txHash: 'SKIP-SOURCE', chainId: 'cosmoshub-4', fetchImpl })
      ).resolves.toMatchObject({
        status: 'refunded',
        stage: 'refunded',
        message: 'route failed and assets returned',
      })
    })

    it.each([
      ['STATE_SUBMITTED', 'pending', 'inbound'],
      ['STATE_PENDING', 'pending', 'outbound'],
      ['STATE_PENDING_ERROR', 'pending', 'outbound'],
      ['STATE_ABANDONED', 'error', 'failed'],
      ['STATE_COMPLETED_ERROR', 'error', 'failed'],
    ] as const)('maps %s to %s/%s', async (state, status, stage) => {
      const fetchImpl = vi.fn(async () =>
        jsonResponse({ state, transfer_asset_release: { chain_id: 'other-chain', released: state.includes('ERROR') } })
      ) as typeof fetch

      await expect(
        getSwapArrivalStatus({ provider: 'skip', txHash: 'SKIP-SOURCE', chainId: 'cosmoshub-4', fetchImpl })
      ).resolves.toMatchObject({ status, stage })
    })

    it('requires a non-empty source chain id', async () => {
      await expect(
        getSwapArrivalStatus({ provider: 'skip', txHash: 'SKIP-SOURCE', chainId: ' ', fetchImpl: vi.fn() })
      ).rejects.toThrow('chainId is required for Skip')
    })
  })

  describe('LI.FI', () => {
    it('maps destination waiting to the outbound progress stage and forwards query hints and headers', async () => {
      const fetchImpl = vi.fn(async () => jsonResponse(fixtures.lifiPending)) as typeof fetch
      const headers = { 'x-lifi-api-key': 'test-key' }

      await expect(
        getSwapArrivalStatus({
          provider: 'li.fi',
          txHash: '0xsource',
          fromChain: 1,
          toChain: 137,
          bridge: 'across',
          fetchImpl,
          headers,
        })
      ).resolves.toMatchObject({ status: 'pending', stage: 'outbound' })

      expect(fetchImpl).toHaveBeenCalledWith(
        'https://li.quest/v1/status?txHash=0xsource&fromChain=1&toChain=137&bridge=across',
        expect.objectContaining({ headers })
      )
    })

    it('normalizes DONE/REFUNDED separately from successful DONE outcomes', async () => {
      const fetchImpl = vi.fn(async () => jsonResponse(fixtures.lifiRefunded)) as typeof fetch

      await expect(getSwapArrivalStatus({ provider: 'li.fi', txHash: '0xsource', fetchImpl })).resolves.toEqual({
        provider: 'li.fi',
        txHash: '0xsource',
        status: 'refunded',
        stage: 'refunded',
        destinationTxHash: '0xrefund',
        message: 'Tokens were refunded.',
      })
    })

    it('normalizes DONE/PARTIAL as partial instead of flattening it into success', async () => {
      const fetchImpl = vi.fn(async () =>
        jsonResponse({
          status: 'DONE',
          substatus: 'PARTIAL',
          substatusMessage: 'The user received less tokens than expected.',
          sending: { txHash: '0xsource' },
          receiving: { txHash: '0xreceived' },
        })
      ) as typeof fetch

      await expect(getSwapArrivalStatus({ provider: 'li.fi', txHash: '0xsource', fetchImpl })).resolves.toEqual({
        provider: 'li.fi',
        txHash: '0xsource',
        status: 'partial',
        stage: 'complete',
        destinationTxHash: '0xreceived',
        message: 'The user received less tokens than expected.',
      })
    })

    it('keeps the default host when a partial host override is undefined', async () => {
      const fetchImpl = vi.fn(async () => jsonResponse({ status: 'NOT_FOUND' })) as typeof fetch

      await expect(
        getSwapArrivalStatus({ provider: 'li.fi', txHash: '0xsource', hosts: { lifi: undefined }, fetchImpl })
      ).resolves.toMatchObject({ status: 'not_found', stage: 'not_found' })

      expect(fetchImpl).toHaveBeenCalledWith('https://li.quest/v1/status?txHash=0xsource', expect.any(Object))
    })

    it('keeps LI.FI not-found snapshots pollable during provider indexing', async () => {
      const fetchImpl = vi.fn(async () => jsonResponse({ status: 'NOT_FOUND' })) as typeof fetch

      const result = await getSwapArrivalStatus({ provider: 'li.fi', txHash: '0xsource', fetchImpl })

      expect(result).toEqual({
        provider: 'li.fi',
        txHash: '0xsource',
        status: 'not_found',
        stage: 'not_found',
      })
      expect(isSwapArrivalStatusTerminal(result)).toBe(false)
    })

    it.each([
      [{ status: 'NOT_FOUND' }, 'not_found', 'not_found'],
      [{ status: 'INVALID' }, 'error', 'failed'],
      [{ status: 'FAILED' }, 'error', 'failed'],
      [{ status: 'DONE', substatus: 'COMPLETED' }, 'success', 'complete'],
      [{ status: 'DONE', substatus: 'PARTIAL' }, 'partial', 'complete'],
      [{ status: 'PENDING', substatus: 'WAIT_SOURCE_CONFIRMATIONS' }, 'pending', 'confirming'],
      [{ status: 'PENDING', substatus: 'REFUND_IN_PROGRESS' }, 'pending', 'refunding'],
    ] as const)('maps $status/$substatus to $1/$2', async (body, status, stage) => {
      const fetchImpl = vi.fn(async () => jsonResponse(body)) as typeof fetch

      await expect(getSwapArrivalStatus({ provider: 'li.fi', txHash: '0xsource', fetchImpl })).resolves.toMatchObject({
        status,
        stage,
      })
    })
  })

  it('rejects an empty transaction hash before making a request', async () => {
    const fetchImpl = vi.fn()
    await expect(getSwapArrivalStatus({ provider: 'li.fi', txHash: '  ', fetchImpl })).rejects.toThrow(
      'txHash must not be empty'
    )
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('keeps pending and not-found snapshots pollable while classifying settled outcomes as terminal', () => {
    expect(
      isSwapArrivalStatusTerminal({ provider: 'skip', txHash: 'hash', status: 'pending', stage: 'outbound' })
    ).toBe(false)
    expect(
      isSwapArrivalStatusTerminal({ provider: 'li.fi', txHash: 'hash', status: 'not_found', stage: 'not_found' })
    ).toBe(false)
    expect(
      isSwapArrivalStatusTerminal({ provider: 'skip', txHash: 'hash', status: 'refunded', stage: 'refunded' })
    ).toBe(true)
  })
})
