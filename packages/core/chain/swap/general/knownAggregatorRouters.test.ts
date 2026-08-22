import { describe, expect, it, vi } from 'vitest'

import { Chain, EvmChain } from '../../Chain'
import { blockaidEvmChain } from '../../security/blockaid/evmChains'
import { COW_VAULT_RELAYER_ADDRESS, cowSwapSupportedChains } from './cowswap/config'
import {
  assertKnownAggregatorRouter,
  assertKnownAggregatorRouterOnSigningPath,
  assertSwapKitDestinationMatchesTarget,
  isKnownAggregatorRouterAddress,
  logUnenforcedAggregatorDestination,
} from './knownAggregatorRouters'
import { swapKitSourceChains } from './swapkit/SwapKitEnabledChains'

const ONE_INCH_V6 = '0x111111125421ca6dc452d289314280a0f8842a65'
const ONE_INCH_V5 = '0x1111111254eeb25477b68fb85ed929f73a960582'
const ONE_INCH_V6_ZKSYNC = '0x6fd4383cb451173d5f9304f041c7bcbf27d561ff'
const ONE_INCH_V6_ROBINHOOD = '0x5a705de8982235a7fa45bb83dcacf03a211389c7'
const KYBER_V2 = '0x6131b5fae19ea4f9d964eac0408e4408b66337b5'
const LIFI_DIAMOND = '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE'
const LIFI_DIAMOND_HYPEREVM = '0x0a0758d937d1059c356D4714e57F5df0239bce1A'
const LIFI_DIAMOND_ROBINHOOD = '0xB477751B76CF82d00a686A1232f5fCD772414Af3'
const LIFI_DIAMOND_ZKSYNC = '0x341e94069f53234fE6DabeF707aD424830525715'
const ATTACKER_ADDRESS = '0x00000000000000000000000000000000deadbeef'

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

  // Robinhood (4663) is the second chain-specific 1inch deployment after zkSync —
  // live-confirmed 2026-07-27 via /approve/spender + a real v6.0 /swap both returning
  // this address, with 24,542 bytes of code at it on-chain.
  describe('1inch Robinhood — a genuinely different router (chain-scoping)', () => {
    it('accepts the Robinhood-specific router ONLY on Robinhood', () => {
      expect(() => assertKnownAggregatorRouter('1inch', ONE_INCH_V6_ROBINHOOD, Chain.Robinhood)).not.toThrow()
    })

    it('REJECTS the standard V6 router on Robinhood', () => {
      expect(() => assertKnownAggregatorRouter('1inch', ONE_INCH_V6, Chain.Robinhood)).toThrow(
        /unrecognized router address/
      )
    })

    it('REJECTS the standard V5 router on Robinhood', () => {
      expect(() => assertKnownAggregatorRouter('1inch', ONE_INCH_V5, Chain.Robinhood)).toThrow(
        /unrecognized router address/
      )
    })

    it('REJECTS the Robinhood-specific router on a DIFFERENT chain (Ethereum) — scoping is not accidentally global', () => {
      expect(() => assertKnownAggregatorRouter('1inch', ONE_INCH_V6_ROBINHOOD, Chain.Ethereum)).toThrow(
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

  it('accepts the official LI.FI Diamond on every standard-address SDK EVM chain', () => {
    for (const chain of [
      Chain.Arbitrum,
      Chain.Avalanche,
      Chain.Base,
      Chain.Blast,
      Chain.BSC,
      Chain.CronosChain,
      Chain.Ethereum,
      Chain.Mantle,
      Chain.Optimism,
      Chain.Polygon,
      Chain.Sei,
    ]) {
      expect(() => assertKnownAggregatorRouter('li.fi', LIFI_DIAMOND, chain)).not.toThrow()
    }
  })

  it.each([
    [Chain.Hyperliquid, LIFI_DIAMOND_HYPEREVM],
    [Chain.Robinhood, LIFI_DIAMOND_ROBINHOOD],
    [Chain.Zksync, LIFI_DIAMOND_ZKSYNC],
  ])('accepts the chain-specific LI.FI Diamond on %s', (chain, address) => {
    expect(() => assertKnownAggregatorRouter('li.fi', address, chain)).not.toThrow()
    expect(() => assertKnownAggregatorRouter('li.fi', LIFI_DIAMOND, chain)).toThrow(/unrecognized router address/)
  })

  it('REJECTS an attacker-controlled LI.FI destination', () => {
    expect(() => assertKnownAggregatorRouter('li.fi', ATTACKER_ADDRESS, Chain.Ethereum)).toThrow(
      /unrecognized router address/
    )
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

    // sdk#1457 review: the relayer is a DETERMINISTIC address, so it resolves on every EVM chain -
    // but CoW has only deployed the GPv2 stack on cowSwapSupportedChains. Accepting it
    // chain-agnostically let a tampered payload relabelled 'cowswap' on an unsupported chain pass
    // both this guard AND the approval-spender bind, so the co-signer would sign an ERC-20 approve
    // to an address with no code (verified live 2026-07-21: eth_getCode is `0x` on CronosChain /
    // Zksync / Blast) that anyone can later claim via the public deterministic deployment proxy.
    it.each(cowSwapSupportedChains)('accepts the relayer on the supported chain %s', chain => {
      expect(() => assertKnownAggregatorRouter('cowswap', COW_VAULT_RELAYER_ADDRESS, chain)).not.toThrow()
    })

    it.each([Chain.CronosChain, Chain.Zksync, Chain.Blast, Chain.Polygon, Chain.BSC, Chain.Sei, Chain.Hyperliquid])(
      'REJECTS the relayer on %s — CowSwap is not deployed there, so an approve to it is unbacked',
      chain => {
        expect(() => assertKnownAggregatorRouter('cowswap', COW_VAULT_RELAYER_ADDRESS, chain)).toThrow(
          /unrecognized router address/
        )
      }
    )
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

  it('enforces li.fi and refuses a synchronous log-only check for dynamic swapkit destinations', () => {
    expect(() => assertKnownAggregatorRouterOnSigningPath('li.fi', ATTACKER_ADDRESS, Chain.Ethereum)).toThrow(
      /unrecognized router address/
    )
    expect(() => assertKnownAggregatorRouterOnSigningPath('li.fi', LIFI_DIAMOND, Chain.Ethereum)).not.toThrow()
    expect(() => assertKnownAggregatorRouterOnSigningPath('swapkit', ATTACKER_ADDRESS, Chain.Ethereum)).toThrow(
      /independent reputation guard/
    )
  })

  // sdk#1457 backward-compat: real mobile golden fixtures (mobileFixtures.golden.test.ts's
  // arb.json "via 1inch" / lifiswap.json) carry NO `provider` at all - mapSwapPayload.ts
  // deliberately falls back to `''` rather than mislabeling them '1inch'. Their destinations are
  // real 1inch V6 / LI.FI Diamond addresses (proven against the fixtures themselves), so `''`
  // stays log-only ONLY when the destination already matches a known router.
  it('does NOT reject the legacy unattributed (empty-string) provider when the destination is a known router - real historical fixtures rely on this', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
    expect(() => assertKnownAggregatorRouterOnSigningPath('', ONE_INCH_V6, Chain.Ethereum)).not.toThrow()
    expect(() => assertKnownAggregatorRouterOnSigningPath('', LIFI_DIAMOND, Chain.Ethereum)).not.toThrow()
    spy.mockRestore()
  })

  // sdk#1500: before this fix, `''` was a full bypass regardless of `address` - a payload could
  // relabel ANY malicious destination as `''` and skip every check above. This is the regression
  // test for that closed gap: an attacker-controlled address paired with `''` must now be rejected
  // synchronously (requiring the caller to fall back to the asynchronous reputation guard), not
  // silently logged and passed.
  it('REJECTS a legacy unattributed (empty-string) provider whose destination is not a known router (sdk#1500 relabel-to-empty-string bypass)', () => {
    expect(() => assertKnownAggregatorRouterOnSigningPath('', ATTACKER_ADDRESS, Chain.Ethereum)).toThrow(
      /does not match any known aggregator router/
    )
  })
})

describe('isKnownAggregatorRouterAddress — sdk#1500 legacy-destination fast path', () => {
  it('matches every enforced provider router it was built from', () => {
    expect(isKnownAggregatorRouterAddress(ONE_INCH_V6, Chain.Ethereum)).toBe(true)
    expect(isKnownAggregatorRouterAddress(KYBER_V2, Chain.Ethereum)).toBe(true)
    expect(isKnownAggregatorRouterAddress(LIFI_DIAMOND, Chain.Ethereum)).toBe(true)
    expect(isKnownAggregatorRouterAddress(COW_VAULT_RELAYER_ADDRESS, cowSwapSupportedChains[0])).toBe(true)
  })

  it('is chain-scoped, mirroring assertKnownAggregatorRouter', () => {
    expect(isKnownAggregatorRouterAddress(ONE_INCH_V6_ZKSYNC, Chain.Zksync)).toBe(true)
    expect(isKnownAggregatorRouterAddress(ONE_INCH_V6_ZKSYNC, Chain.Ethereum)).toBe(false)
  })

  it('returns false for an address that matches no known router', () => {
    expect(isKnownAggregatorRouterAddress(ATTACKER_ADDRESS, Chain.Ethereum)).toBe(false)
  })
})

describe('assertSwapKitDestinationMatchesTarget — sdk#1458 response binding', () => {
  it('accepts a case-insensitive match with the screened targetAddress', () => {
    expect(() =>
      assertSwapKitDestinationMatchesTarget(
        '0x111111125421ca6dc452d289314280a0f8842a65',
        '0x111111125421CA6dc452D289314280a0F8842A65',
        Chain.Ethereum
      )
    ).not.toThrow()
  })

  it('rejects an arbitrary tx.to that does not match targetAddress', () => {
    expect(() => assertSwapKitDestinationMatchesTarget(ATTACKER_ADDRESS, LIFI_DIAMOND, Chain.Ethereum)).toThrow(
      /does not match the screened targetAddress/
    )
  })

  it.each([undefined, '', 'not-an-address'])('rejects missing or malformed targetAddress: %s', targetAddress => {
    expect(() => assertSwapKitDestinationMatchesTarget(ATTACKER_ADDRESS, targetAddress, Chain.Ethereum)).toThrow(
      /did not include a valid targetAddress/
    )
  })
})

describe('logUnenforcedAggregatorDestination — dynamic/legacy signing payloads, never throws', () => {
  it('never throws regardless of the address', () => {
    expect(() => logUnenforcedAggregatorDestination('swapkit', 'not-even-an-address')).not.toThrow()
  })

  it('logs provider + address so a future allowlist has real usage data to build from', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
    logUnenforcedAggregatorDestination('swapkit', '0xabc')
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('swap-router-telemetry'), {
      provider: 'swapkit',
      address: '0xabc',
    })
    spy.mockRestore()
  })
})

describe('SwapKit EVM source chains are fully covered by Blockaid — sdk#1458 review follow-up', () => {
  it('every EVM chain SwapKit can source from also has a blockaidEvmChain mapping', () => {
    // assertSwapKitAddressReputation throws "cannot be verified on unsupported Blockaid chain"
    // for any EVM chain missing from blockaidEvmChain. Today that's fine — neither CronosChain
    // nor Robinhood is a swapKitSourceChains entry — but adding either to swapKitSourceChains
    // in the future would look like a harmless one-line change and would silently make every
    // SwapKit swap FROM that chain a 100%, outage-independent refusal (not a Blockaid outage,
    // not a flaky network call — a guaranteed throw on every single attempt). This test turns
    // that into a loud, immediate failure here instead of a field report.
    const evmSwapKitSourceChains = swapKitSourceChains.filter(chain => chain in EvmChain) as EvmChain[]

    const uncoveredChains = evmSwapKitSourceChains.filter(chain => !(chain in blockaidEvmChain))

    expect(uncoveredChains).toEqual([])
  })
})
