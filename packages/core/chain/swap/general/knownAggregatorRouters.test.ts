import { describe, expect, it, vi } from 'vitest'

import {
  assertKnownAggregatorRouter,
  KYBER_ROUTER_ADDRESSES,
  logUnenforcedAggregatorDestination,
  ONE_INCH_ROUTER_ADDRESSES,
} from './knownAggregatorRouters'

const ONE_INCH_V6 = '0x111111125421ca6dc452d289314280a0f8842a65'
const ONE_INCH_V5 = '0x1111111254eeb25477b68fb85ed929f73a960582'
const KYBER_V2 = '0x6131b5fae19ea4f9d964eac0408e4408b66337b5'

describe('assertKnownAggregatorRouter — AGG-02 fund-safety allowlist', () => {
  it('accepts 1inch V6 (live-confirmed against the real quote API)', () => {
    expect(() => assertKnownAggregatorRouter('1inch', ONE_INCH_V6)).not.toThrow()
  })

  it('accepts 1inch V5 (legacy, still in the allowlist)', () => {
    expect(() => assertKnownAggregatorRouter('1inch', ONE_INCH_V5)).not.toThrow()
  })

  it('accepts a mixed-case / checksummed address (case-insensitive match)', () => {
    expect(() => assertKnownAggregatorRouter('1inch', '0x111111125421CA6dc452D289314280a0F8842A65')).not.toThrow()
  })

  it('accepts KyberSwap MetaAggregationRouterV2 (live-confirmed against the real /routes API)', () => {
    expect(() => assertKnownAggregatorRouter('kyber', KYBER_V2)).not.toThrow()
  })

  it("REJECTS a 1inch response carrying Kyber's router (cross-provider mismatch)", () => {
    expect(() => assertKnownAggregatorRouter('1inch', KYBER_V2)).toThrow(/unrecognized router address/)
  })

  it('REJECTS a spoofed/attacker-controlled address for 1inch', () => {
    expect(() => assertKnownAggregatorRouter('1inch', '0x000000000000000000000000000000deadbeef')).toThrow(
      /unrecognized router address/
    )
  })

  it('REJECTS a spoofed/attacker-controlled address for Kyber', () => {
    expect(() => assertKnownAggregatorRouter('kyber', '0x000000000000000000000000000000deadbeef')).toThrow(
      /unrecognized router address/
    )
  })

  it('the error message names the provider and the rejected address (diagnosable, not silent)', () => {
    expect(() => assertKnownAggregatorRouter('kyber', '0xbad')).toThrow(/kyber.*0xbad/)
  })
})

describe('logUnenforcedAggregatorDestination — LiFi/SwapKit, never throws', () => {
  it('never throws regardless of the address', () => {
    expect(() => logUnenforcedAggregatorDestination('li.fi', '0x000000000000000000000000000000deadbeef')).not.toThrow()
    expect(() => logUnenforcedAggregatorDestination('swapkit', 'not-even-an-address')).not.toThrow()
  })

  it('logs provider + address so a future allowlist has real usage data to build from', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
    logUnenforcedAggregatorDestination('li.fi', '0xabc')
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('swap-router-telemetry'), {
      provider: 'li.fi',
      address: '0xabc',
    })
    spy.mockRestore()
  })
})

describe('allowlist contents — sanity (catches an accidental edit widening the fund-safety gate)', () => {
  it('1inch allowlist has exactly V5 + V6, nothing else', () => {
    expect([...ONE_INCH_ROUTER_ADDRESSES].sort()).toEqual([ONE_INCH_V5, ONE_INCH_V6].sort())
  })

  it('Kyber allowlist has exactly the v2 router, nothing else', () => {
    expect([...KYBER_ROUTER_ADDRESSES]).toEqual([KYBER_V2])
  })
})
