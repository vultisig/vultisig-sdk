import { describe, expect, it, vi } from 'vitest'

import {
  getCosmosValidator,
  getCosmosValidators,
  getValidatorsUrl,
  getValidatorUrl,
  type Validator,
} from './lcdQueries'

// ---------------------------------------------------------------------------
// Fixtures (captured 2026-05-18 from terra-lcd.publicnode.com — trimmed).
// ---------------------------------------------------------------------------

const fixtureAllnodes = {
  operator_address: 'terravaloper1q0n2vrlp9eqxlqvwwlz39pn3jx2fmjlk5jrn6w',
  consensus_pubkey: { '@type': '/cosmos.crypto.ed25519.PubKey', key: 'abc' },
  jailed: false,
  status: 'BOND_STATUS_BONDED' as const,
  tokens: '200392000000',
  delegator_shares: '200392000000.000000000000000000',
  description: {
    moniker: 'Allnodes',
    identity: 'D6A82E132683E0F4',
    website: 'https://allnodes.com',
    security_contact: '',
    details: 'Hardened bare-metal validator infrastructure.',
  },
  commission: {
    commission_rates: {
      rate: '0.050000000000000000',
      max_rate: '0.200000000000000000',
      max_change_rate: '0.010000000000000000',
    },
    update_time: '2024-01-01T00:00:00Z',
  },
  min_self_delegation: '1',
  unbonding_height: '0',
  unbonding_time: '1970-01-01T00:00:00Z',
}

const fixtureChorusJailed = {
  operator_address: 'terravaloper1chorusxyz123456789',
  jailed: true,
  status: 'BOND_STATUS_UNBONDING' as const,
  tokens: '0',
  delegator_shares: '0.000000000000000000',
  description: {
    moniker: 'Chorus One',
    identity: '',
    website: '',
    security_contact: '',
    details: '',
  },
  commission: {
    commission_rates: {
      rate: '0.062300000000000000',
      max_rate: '0.250000000000000000',
      max_change_rate: '0.010000000000000000',
    },
    update_time: '2024-01-01T00:00:00Z',
  },
  min_self_delegation: '1',
}

const fixtureMinimal = {
  // Some chains return validators with the `description` sub-fields entirely
  // missing (only `moniker` set). Verify we tolerate that.
  operator_address: 'terravaloper1minimal',
  status: 'BOND_STATUS_BONDED' as const,
  tokens: '1',
  delegator_shares: '1.000000000000000000',
  description: { moniker: 'minimal' },
  commission: {
    commission_rates: {
      rate: '0.000000000000000000',
      max_rate: '0.000000000000000000',
      max_change_rate: '0.000000000000000000',
    },
  },
  min_self_delegation: '1',
}

const mkFetch = (responder: (url: string) => Response | Promise<Response>) =>
  vi.fn(async (url: string | URL): Promise<Response> => {
    const u = typeof url === 'string' ? url : url.toString()
    return responder(u)
  }) as unknown as typeof fetch

const okJson = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

const status = (code: number): Response => new Response('', { status: code })

// ---------------------------------------------------------------------------
// URL builders
// ---------------------------------------------------------------------------

describe('getValidatorsUrl', () => {
  it('builds a bare URL against the Terra LCD when no options are passed', () => {
    expect(getValidatorsUrl('Terra')).toMatch(/\/cosmos\/staking\/v1beta1\/validators$/)
  })

  it('appends status and pagination.limit when provided', () => {
    const url = getValidatorsUrl('Terra', {
      status: 'BOND_STATUS_BONDED',
      limit: 200,
    })
    expect(url).toContain('status=BOND_STATUS_BONDED')
    expect(url).toContain('pagination.limit=200')
  })

  it('appends pagination.key for subsequent pages', () => {
    const url = getValidatorsUrl('Terra', { paginationKey: 'cursor123==' })
    // URLSearchParams encodes '=' as '%3D' — that's what the LCD expects on
    // the next-page request, so verify the encoding is preserved.
    expect(url).toMatch(/pagination\.key=cursor123%3D%3D/)
  })

  it('points TerraClassic at the classic LCD, not the v2 LCD', () => {
    // Different chains route through different LCD roots; confirm we don't
    // accidentally hardcode the Terra v2 endpoint.
    expect(getValidatorsUrl('TerraClassic')).not.toEqual(getValidatorsUrl('Terra'))
  })
})

describe('getValidatorUrl', () => {
  it('builds the single-validator path with the valoper segment', () => {
    expect(getValidatorUrl('Terra', 'terravaloper1q0n2vrlp9eqxlqvwwlz39pn3jx2fmjlk5jrn6w')).toMatch(
      /\/cosmos\/staking\/v1beta1\/validators\/terravaloper1q0n2vrlp9eqxlqvwwlz39pn3jx2fmjlk5jrn6w$/
    )
  })
})

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

describe('getCosmosValidators', () => {
  it('parses the Cosmos LCD shape into the typed Validator domain model', async () => {
    const fetchImpl = mkFetch(() =>
      okJson({
        validators: [fixtureAllnodes],
        pagination: { next_key: null, total: '1' },
      })
    )
    const validators = await getCosmosValidators('Terra', { fetchImpl })
    expect(validators).toHaveLength(1)
    const v = validators[0] as Validator
    expect(v.operatorAddress).toBe('terravaloper1q0n2vrlp9eqxlqvwwlz39pn3jx2fmjlk5jrn6w')
    expect(v.jailed).toBe(false)
    expect(v.status).toBe('BOND_STATUS_BONDED')
    expect(v.tokens).toBe('200392000000')
    expect(v.description.moniker).toBe('Allnodes')
    expect(v.description.identity).toBe('D6A82E132683E0F4')
    expect(v.commission.rate).toBe('0.050000000000000000')
  })

  it('tolerates jailed validators and partial description fields', async () => {
    const fetchImpl = mkFetch(() =>
      okJson({
        validators: [fixtureChorusJailed, fixtureMinimal],
        pagination: { next_key: null },
      })
    )
    const validators = await getCosmosValidators('Terra', { fetchImpl })
    expect(validators).toHaveLength(2)
    expect(validators[0]?.jailed).toBe(true)
    expect(validators[0]?.description.website).toBe('')
    // Description sub-fields default to '' when LCD omits them — callers
    // can safely render description.identity without optional chaining.
    expect(validators[1]?.description.identity).toBe('')
    expect(validators[1]?.description.securityContact).toBe('')
  })

  it('auto-paginates: follows pagination.next_key until null', async () => {
    let calls = 0
    const fetchImpl = mkFetch(url => {
      calls++
      if (calls === 1) {
        // First page: returns next_key so caller must follow.
        expect(url).not.toContain('pagination.key=')
        return okJson({
          validators: [fixtureAllnodes],
          pagination: { next_key: 'CURSOR_A' },
        })
      }
      if (calls === 2) {
        expect(url).toContain('pagination.key=CURSOR_A')
        return okJson({
          validators: [fixtureChorusJailed],
          pagination: { next_key: 'CURSOR_B' },
        })
      }
      // Third page: terminates with null.
      expect(url).toContain('pagination.key=CURSOR_B')
      return okJson({
        validators: [fixtureMinimal],
        pagination: { next_key: null },
      })
    })
    const validators = await getCosmosValidators('Terra', { fetchImpl })
    expect(calls).toBe(3)
    expect(validators.map(v => v.operatorAddress)).toEqual([
      'terravaloper1q0n2vrlp9eqxlqvwwlz39pn3jx2fmjlk5jrn6w',
      'terravaloper1chorusxyz123456789',
      'terravaloper1minimal',
    ])
  })

  it('throws after exceeding the pagination safety cap (defends against runaway LCDs)', async () => {
    // Always-returns-next-key fetch simulates a broken LCD; without the cap
    // the caller would loop forever or OOM. Bound at 50 pages.
    const fetchImpl = mkFetch(() =>
      okJson({
        validators: [fixtureMinimal],
        pagination: { next_key: 'NEVER_NULL' },
      })
    )
    await expect(getCosmosValidators('Terra', { fetchImpl })).rejects.toThrow(/exceeded 50 pages/)
  })

  it('forwards the status filter into the query string', async () => {
    const fetchImpl = mkFetch(url => {
      expect(url).toContain('status=BOND_STATUS_BONDED')
      return okJson({ validators: [], pagination: { next_key: null } })
    })
    await getCosmosValidators('Terra', {
      fetchImpl,
      status: 'BOND_STATUS_BONDED',
    })
  })

  it('throws on non-2xx responses', async () => {
    const fetchImpl = mkFetch(() => status(503))
    await expect(getCosmosValidators('Terra', { fetchImpl })).rejects.toThrow(/LCD 503/)
  })

  it('passes through abort signal', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      expect(init?.signal).toBeDefined()
      return okJson({ validators: [], pagination: { next_key: null } })
    }) as unknown as typeof fetch
    const ac = new AbortController()
    await getCosmosValidators('Terra', { fetchImpl, signal: ac.signal })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })
})

describe('getCosmosValidator', () => {
  it('unwraps the single-validator response shape', async () => {
    const fetchImpl = mkFetch(() => okJson({ validator: fixtureAllnodes }))
    const v = await getCosmosValidator('Terra', 'terravaloper1q0n2vrlp9eqxlqvwwlz39pn3jx2fmjlk5jrn6w', { fetchImpl })
    expect(v.operatorAddress).toBe('terravaloper1q0n2vrlp9eqxlqvwwlz39pn3jx2fmjlk5jrn6w')
    expect(v.description.moniker).toBe('Allnodes')
  })

  it('throws on 404 (unknown valoper)', async () => {
    const fetchImpl = mkFetch(() => status(404))
    await expect(getCosmosValidator('Terra', 'terravaloper1nope', { fetchImpl })).rejects.toThrow(/LCD 404/)
  })
})
