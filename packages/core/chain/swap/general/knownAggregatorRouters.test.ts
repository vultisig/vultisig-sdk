import { describe, expect, it, vi } from 'vitest'

import { Chain } from '../../Chain'
import { COW_VAULT_RELAYER_ADDRESS } from './cowswap/config'
import {
  assertKnownAggregatorRouter,
  assertKnownAggregatorRouterOnSigningPath,
  logUnenforcedAggregatorDestination,
} from './knownAggregatorRouters'

const ONE_INCH_V6 = '0x111111125421ca6dc452d289314280a0f8842a65'
const ONE_INCH_V5 = '0x1111111254eeb25477b68fb85ed929f73a960582'
const ONE_INCH_V6_ZKSYNC = '0x6fd4383cb451173d5f9304f041c7bcbf27d561ff'
const KYBER_V2 = '0x6131b5fae19ea4f9d964eac0408e4408b66337b5'
const ATTACKER_ADDRESS = '0x000000000000000000000000000000deadbeef'

describe('assertKnownAggregatorRouter — AGG-02 fund-safety allowlist', () => {
  it('accepts 1inch V6 on Ethereum (live-confirmed against the real quote API)', () => {
    expect(() => assertKnownAggregatorRouter('1inch', ONE_INCH_V6, Chain.Ethereum)).not.toThrow()
  })

  it('accepts 1inch V6 on every non-zkSync EVM chain it supports (live-confirmed)', () => {
    for (const chain of [Chain.Arbitrum, Chain.BSC, Chain.Base, Chain.Optimism, Chain.Avalanche, Chain.Polygon]) {
      expect(() => assertKnownAggregatorRouter('1inch', ONE_INCH_V6, chain)).not.toThrow()
    }
  })

  it('accepts 1inch V5 (legacy, unscoped)', () => {
    expect(() => assertKnownAggregatorRouter('1inch', ONE_INCH_V5, Chain.Ethereum)).not.toThrow()
  })

  it('accepts a mixed-case / checksummed address (case-insensitive match)', () => {
    expect(() =>
      assertKnownAggregatorRouter('1inch', '0x111111125421CA6dc452D289314280a0F8842A65', Chain.Ethereum)
    ).not.toThrow()
  })

  // codex review (PR #1079): 1inch's V6 router is NOT the same address on zkSync Era —
  // confirmed live via a real quote request. A chain-agnostic allowlist would have
  // hard-blocked every legitimate zkSync 1inch swap.
  describe('1inch zkSync Era — a genuinely different router (chain-scoping)', () => {
    it('accepts the zkSync-specific router ONLY on zkSync', () => {
      expect(() => assertKnownAggregatorRouter('1inch', ONE_INCH_V6_ZKSYNC, Chain.Zksync)).not.toThrow()
    })

    it('REJECTS the standard V6 router on zkSync (the exact bug this fixes)', () => {
      expect(() => assertKnownAggregatorRouter('1inch', ONE_INCH_V6, Chain.Zksync)).toThrow(
        /unrecognized router address/
      )
    })

    it('REJECTS the zkSync-specific router on a DIFFERENT chain (Ethereum) — scoping is not accidentally global', () => {
      expect(() => assertKnownAggregatorRouter('1inch', ONE_INCH_V6_ZKSYNC, Chain.Ethereum)).toThrow(
        /unrecognized router address/
      )
    })
  })

  it('accepts KyberSwap MetaAggregationRouterV2 (live-confirmed against the real /routes API, unscoped — no chain variance found)', () => {
    for (const chain of [
      Chain.Ethereum,
      Chain.BSC,
      Chain.Arbitrum,
      Chain.Optimism,
      Chain.Avalanche,
      Chain.Base,
      Chain.Polygon,
    ]) {
      expect(() => assertKnownAggregatorRouter('kyber', KYBER_V2, chain)).not.toThrow()
    }
  })

  it("REJECTS a 1inch response carrying Kyber's router (cross-provider mismatch)", () => {
    expect(() => assertKnownAggregatorRouter('1inch', KYBER_V2, Chain.Ethereum)).toThrow(/unrecognized router address/)
  })

  it('REJECTS a spoofed/attacker-controlled address for 1inch', () => {
    expect(() =>
      assertKnownAggregatorRouter('1inch', '0x000000000000000000000000000000deadbeef', Chain.Ethereum)
    ).toThrow(/unrecognized router address/)
  })

  it('REJECTS a spoofed/attacker-controlled address for Kyber', () => {
    expect(() =>
      assertKnownAggregatorRouter('kyber', '0x000000000000000000000000000000deadbeef', Chain.Ethereum)
    ).toThrow(/unrecognized router address/)
  })

  it('the error message names the provider, chain, and the rejected address (diagnosable, not silent)', () => {
    expect(() => assertKnownAggregatorRouter('kyber', '0xbad', Chain.Ethereum)).toThrow(/kyber.*0xbad.*Ethereum/)
  })

  // sdk#1457: CowSwap settles off-chain via solvers, so unlike 1inch/Kyber it has no "swap router" -
  // but its on-chain leg is always the same fixed GPv2VaultRelayer contract, which makes it exactly
  // as allow-listable as a router address.
  describe('CowSwap — GPv2VaultRelayer (sdk#1457, now enforced)', () => {
    it('accepts the real GPv2VaultRelayer address', () => {
      expect(() => assertKnownAggregatorRouter('cowswap', COW_VAULT_RELAYER_ADDRESS, Chain.Ethereum)).not.toThrow()
    })

    it('accepts a mixed-case / checksummed relayer address', () => {
      expect(() =>
        assertKnownAggregatorRouter('cowswap', COW_VAULT_RELAYER_ADDRESS.toUpperCase(), Chain.Ethereum)
      ).not.toThrow()
    })

    it('REJECTS a spoofed/attacker-controlled address labeled cowswap', () => {
      expect(() => assertKnownAggregatorRouter('cowswap', ATTACKER_ADDRESS, Chain.Ethereum)).toThrow(
        /unrecognized router address/
      )
    })

    it('REJECTS a 1inch router mislabeled cowswap (cross-provider mismatch, same as 1inch vs kyber)', () => {
      expect(() => assertKnownAggregatorRouter('cowswap', ONE_INCH_V6, Chain.Ethereum)).toThrow(
        /unrecognized router address/
      )
    })
  })
})

// sdk#1457: co-signer swap guards were keying enforcement purely on the untrusted `provider`
// string - an attacker could relabel a malicious swap to ANY string outside {1inch, kyber} and
// skip the router check entirely. These tests cover the fix directly: a legit payload whose
// provider label matches its actual destination passes; a relabelled payload is rejected fail-closed.
describe('assertKnownAggregatorRouterOnSigningPath — sdk#1457 provider-string spoofing guard', () => {
  it('PASSES a legit 1inch payload whose provider label matches its router destination', () => {
    expect(() => assertKnownAggregatorRouterOnSigningPath('1inch', ONE_INCH_V6, Chain.Ethereum)).not.toThrow()
  })

  it('PASSES a legit cowswap payload whose provider label matches the fixed relayer destination', () => {
    expect(() =>
      assertKnownAggregatorRouterOnSigningPath('cowswap', COW_VAULT_RELAYER_ADDRESS, Chain.Ethereum)
    ).not.toThrow()
  })

  it('REJECTS a payload relabelled from an enforced provider to cowswap with a non-relayer destination (label-vs-shape mismatch)', () => {
    // Same attack shape as "spoof to 1inch with the wrong router", just via the newly-enforced provider.
    expect(() => assertKnownAggregatorRouterOnSigningPath('cowswap', ATTACKER_ADDRESS, Chain.Ethereum)).toThrow(
      /unrecognized router address/
    )
  })

  it('REJECTS a payload whose provider is an unrecognized/garbage string (the previously-open bypass)', () => {
    // Before sdk#1457 this fell into "unenforced, log-only" and passed silently regardless of
    // `address` - the exact relabel-to-escape-enforcement bypass the issue describes.
    expect(() =>
      assertKnownAggregatorRouterOnSigningPath('totally-not-a-real-provider', ATTACKER_ADDRESS, Chain.Ethereum)
    ).toThrow(/Unrecognized swap provider/)
  })

  it('still logs (does not throw) for the genuinely unenforceable, recognized li.fi/swapkit providers', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
    expect(() => assertKnownAggregatorRouterOnSigningPath('li.fi', ATTACKER_ADDRESS, Chain.Ethereum)).not.toThrow()
    expect(() => assertKnownAggregatorRouterOnSigningPath('swapkit', ATTACKER_ADDRESS, Chain.Ethereum)).not.toThrow()
    spy.mockRestore()
  })

  // sdk#1457 backward-compat: real mobile golden fixtures (mobileFixtures.golden.test.ts's
  // arb.json "via 1inch" / lifiswap.json) carry NO `provider` at all - mapSwapPayload.ts
  // deliberately falls back to `''` rather than mislabeling them '1inch'. `''` must stay in the
  // same unenforced/log-only bucket it was already in, or this fix would break real historical
  // signing flows, not just close the spoofing gap.
  it('does NOT reject the legacy unattributed (empty-string) provider - real historical fixtures rely on this', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
    expect(() => assertKnownAggregatorRouterOnSigningPath('', ATTACKER_ADDRESS, Chain.Ethereum)).not.toThrow()
    spy.mockRestore()
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
