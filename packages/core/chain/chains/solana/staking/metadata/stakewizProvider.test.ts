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
