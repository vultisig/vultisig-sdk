import { afterEach, describe, expect, it, vi } from 'vitest'

import { stakewizValidatorMetadataProvider } from './stakewizProvider'

afterEach(() => {
  vi.unstubAllGlobals()
})

const stubFetch = (impl: typeof fetch) => vi.stubGlobal('fetch', impl)

const okResponse = (rows: unknown) => ({ ok: true, status: 200, json: async () => rows }) as Response

describe('stakewizValidatorMetadataProvider', () => {
  it('maps Stakewiz rows to metadata (percent APY → fraction, score rounded)', async () => {
    stubFetch((async () =>
      okResponse([
        {
          vote_identity: 'V1',
          name: 'Alice',
          image: 'https://logo/alice.png',
          apy_estimate: 7.2,
          wiz_score: 95.4,
        },
        { vote_identity: 'V2', name: 'Bob' },
      ])) as typeof fetch)

    const map = await stakewizValidatorMetadataProvider.metadata(['V1'])
    expect(map['V1']).toMatchObject({
      name: 'Alice',
      logoUrl: 'https://logo/alice.png',
      score: 95,
    })
    // percent → fraction (float-safe).
    expect(map['V1']?.apyEstimate).toBeCloseTo(0.072, 10)
    // Only requested pubkeys are returned.
    expect(map['V2']).toBeUndefined()
  })

  it('skips malformed rows and preserves a genuine 0% APY without throwing', async () => {
    stubFetch((async () =>
      okResponse([
        null,
        'garbage',
        42,
        { vote_identity: 123 },
        {
          vote_identity: 'V1',
          name: 456,
          image: null,
          apy_estimate: 'x',
          wiz_score: 'y',
        },
        {
          vote_identity: 'V2',
          name: '  Bob  ',
          apy_estimate: 0,
          wiz_score: 80.6,
        },
      ])) as typeof fetch)

    const map = await stakewizValidatorMetadataProvider.metadata(['V1', 'V2'])
    // Valid pubkey, but every field is invalid → all collapse to undefined.
    expect(map['V1']).toEqual({})
    // Trimmed name, rounded score, and a real 0% APY preserved (not dropped).
    expect(map['V2']).toEqual({
      name: 'Bob',
      logoUrl: undefined,
      apyEstimate: 0,
      score: 81,
    })
  })

  it('returns {} on a non-ok response (graceful degradation)', async () => {
    stubFetch((async () => ({ ok: false, status: 503 }) as Response) as typeof fetch)
    expect(await stakewizValidatorMetadataProvider.metadata(['V1'])).toEqual({})
  })

  it('returns {} when fetch throws (outage)', async () => {
    stubFetch((async () => {
      throw new Error('network down')
    }) as typeof fetch)
    expect(await stakewizValidatorMetadataProvider.metadata(['V1'])).toEqual({})
  })

  it('returns {} for empty input without fetching', async () => {
    const fetchSpy = vi.fn()
    stubFetch(fetchSpy as unknown as typeof fetch)
    expect(await stakewizValidatorMetadataProvider.metadata([])).toEqual({})
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
