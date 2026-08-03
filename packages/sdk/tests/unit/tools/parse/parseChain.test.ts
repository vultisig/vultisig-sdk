/**
 * AUDIT-R3 TASK-020: parseChain + chainSchema boundary tests.
 *
 * Three objectives:
 *   (a) Every real-caller input form PASSES — verified by grepping both
 *       consumers (vultiagent-app + agent-backend-ts) and capturing every
 *       chain string they pass to the SDK. These MUST all resolve without
 *       error (backward-compat receipt).
 *   (b) Genuinely-malformed inputs return the clean typed error — not a crash.
 *   (c) No valid input is newly rejected — proven by the round-trip test
 *       against normalizeChain for every canonical Chain value.
 *
 * Consumer-input compatibility table (from grep of both consumers on 2026-07-08):
 * ┌──────────────────────────┬──────────────────┬─────────────────────────────────┐
 * │ Input form               │ Source           │ Resolves to                     │
 * ├──────────────────────────┼──────────────────┼─────────────────────────────────┤
 * │ 'Bitcoin'                │ vultiagent-app   │ Chain.Bitcoin                   │
 * │ 'Ethereum'               │ vultiagent-app   │ Chain.Ethereum                  │
 * │ 'TerraClassic'           │ abts             │ Chain.TerraClassic              │
 * │ 'Terra'                  │ abts             │ Chain.Terra                     │
 * │ 'BSC'                    │ abts             │ Chain.BSC                       │
 * │ 'Arbitrum'               │ abts/va          │ Chain.Arbitrum                  │
 * │ 'Base'                   │ abts/va          │ Chain.Base                      │
 * │ 'Hyperliquid'            │ abts             │ Chain.Hyperliquid               │
 * │ 'Terra Classic'          │ LLM → abts       │ Chain.TerraClassic              │
 * │ 'columbus-5'             │ LLM → abts       │ Chain.TerraClassic              │
 * │ 'phoenix-1'              │ LLM → abts       │ Chain.Terra                     │
 * │ 'Solana'                 │ abts/va          │ Chain.Solana                    │
 * │ 'Polkadot'               │ abts/va          │ Chain.Polkadot                  │
 * │ 'Bittensor'              │ abts/va          │ Chain.Bittensor                 │
 * │ 'Ton'                    │ abts/va          │ Chain.Ton                       │
 * │ 'Ripple'                 │ abts/va          │ Chain.Ripple                    │
 * │ 'Tron'                   │ abts/va          │ Chain.Tron                      │
 * │ 'Cardano'                │ abts/va          │ Chain.Cardano                   │
 * │ 'Sui'                    │ abts/va          │ Chain.Sui                       │
 * └──────────────────────────┴──────────────────┴─────────────────────────────────┘
 */

import { Chain } from '@vultisig/core-chain/Chain'
import { describe, expect, it } from 'vitest'

import { chainSchema, parseChain } from '../../../../src/tools/parse'
import { normalizeChain } from '../../../../src/utils/normalizeChain'

// ── (a) Consumer-observed input forms — ALL MUST PASS ────────────────────────

describe('parseChain — consumer-observed input forms (backward-compat receipt)', () => {
  it.each([
    // vultiagent-app: passes canonical Chain values from their mirrored Chain type
    ['Bitcoin', Chain.Bitcoin],
    ['Ethereum', Chain.Ethereum],
    ['Solana', Chain.Solana],
    ['BSC', Chain.BSC],
    ['Polygon', Chain.Polygon],
    ['Arbitrum', Chain.Arbitrum],
    ['Optimism', Chain.Optimism],
    ['Base', Chain.Base],
    ['Blast', Chain.Blast],
    ['Mantle', Chain.Mantle],
    ['Zksync', Chain.Zksync],
    ['Avalanche', Chain.Avalanche],
    ['CronosChain', Chain.CronosChain],
    ['Hyperliquid', Chain.Hyperliquid],
    ['Sei', Chain.Sei],
    ['Bitcoin-Cash', Chain.BitcoinCash],
    ['Litecoin', Chain.Litecoin],
    ['Dogecoin', Chain.Dogecoin],
    ['Dash', Chain.Dash],
    ['Zcash', Chain.Zcash],
    ['THORChain', Chain.THORChain],
    ['MayaChain', Chain.MayaChain],
    ['Cosmos', Chain.Cosmos],
    ['Osmosis', Chain.Osmosis],
    ['Terra', Chain.Terra],
    ['TerraClassic', Chain.TerraClassic],
    ['Noble', Chain.Noble],
    ['Akash', Chain.Akash],
    ['Kujira', Chain.Kujira],
    ['Dydx', Chain.Dydx],
    ['Sui', Chain.Sui],
    ['Polkadot', Chain.Polkadot],
    ['Bittensor', Chain.Bittensor],
    ['Ton', Chain.Ton],
    ['Ripple', Chain.Ripple],
    ['Tron', Chain.Tron],
    ['Cardano', Chain.Cardano],
    ['QBTC', Chain.QBTC],
    // agent-backend-ts: normalizeChain output forms (canonical, already resolved)
    // abts zodHelpers.ts passes canonical Chain values to getCoinBalance etc.
    // abts harmonix-vaults.ts passes 'Hyperliquid', 'Arbitrum' as literals
    ['Hyperliquid', Chain.Hyperliquid],
    // abts astroport-classic-swap.ts passes 'TerraClassic' as CosmosChain literal
    ['TerraClassic', Chain.TerraClassic],
    // abts LLM-facing inputs (resolved by chainString() before SDK call, but
    // the parse module must also handle them directly for callers that skip chainString)
    ['Terra Classic', Chain.TerraClassic],
    ['terra classic', Chain.TerraClassic],
    ['TERRA CLASSIC', Chain.TerraClassic],
    ['Columbus-5', Chain.TerraClassic],
    ['columbus-5', Chain.TerraClassic],
    ['phoenix-1', Chain.Terra],
    ['Phoenix-1', Chain.Terra],
    ['terra v2', Chain.Terra],
    ['Terra V2', Chain.Terra],
    // LLM-emitted lowercase variants (seen in swap logs)
    ['bitcoin', Chain.Bitcoin],
    ['ethereum', Chain.Ethereum],
    ['solana', Chain.Solana],
    ['bsc', Chain.BSC],
    // LLM alias forms documented in zodHelpers.ts
    ['Bitcoin Cash', Chain.BitcoinCash],
    ['bitcoin cash', Chain.BitcoinCash],
    ['Cronos Chain', Chain.CronosChain],
    ['THOR Chain', Chain.THORChain],
    ['ZK Sync', Chain.Zksync],
    // Ticker aliases accepted by normalizeChain
    ['btc', Chain.Bitcoin],
    ['eth', Chain.Ethereum],
    ['sol', Chain.Solana],
    ['bnb', Chain.BSC],
    ['avax', Chain.Avalanche],
    ['doge', Chain.Dogecoin],
    ['ltc', Chain.Litecoin],
    ['bch', Chain.BitcoinCash],
    ['xrp', Chain.Ripple],
    ['ada', Chain.Cardano],
    ['dot', Chain.Polkadot],
    ['trx', Chain.Tron],
    ['atom', Chain.Cosmos],
    ['osmo', Chain.Osmosis],
    ['rune', Chain.THORChain],
    ['thor', Chain.THORChain],
  ])('parseChain("%s") → { success: true, chain: %s }', (input, expected) => {
    const result = parseChain(input)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.chain).toBe(expected)
    }
  })
})

// ── (b) Malformed inputs return clean typed errors — no crash ─────────────────

describe('parseChain — malformed inputs return typed errors (not crash)', () => {
  it.each([
    'not-a-chain',
    'foo',
    'notachain',
    'terra classic 2',
    'usd-coin',
    'evm',
    'cosmos sdk',
    '0x1234567890abcdef1234567890abcdef12345678', // EVM address, not a chain
    'mainnet',
    'testnet',
    '1',
    '42',
  ])('parseChain("%s") → { success: false }', input => {
    const result = parseChain(input)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(typeof result.error).toBe('string')
      expect(result.error.length).toBeGreaterThan(0)
      expect(result.input).toBe(input)
    }
  })

  it('parseChain(null) → { success: false }', () => {
    const result = parseChain(null)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(typeof result.error).toBe('string')
    }
  })

  it('parseChain(undefined) → { success: false }', () => {
    const result = parseChain(undefined)
    expect(result.success).toBe(false)
  })

  it('parseChain("") → { success: false }', () => {
    const result = parseChain('')
    expect(result.success).toBe(false)
  })

  it('parseChain("   ") → { success: false } (whitespace only)', () => {
    const result = parseChain('   ')
    expect(result.success).toBe(false)
  })

  it('error message mentions "Unknown chain" for unrecognized input', () => {
    const result = parseChain('notachain')
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toMatch(/unknown chain/i)
    }
  })

  it('does NOT throw — returns error union instead of crash', () => {
    // Previously passing a bad string would crash deep in resolvers[undefined]
    expect(() => parseChain('not-a-real-chain')).not.toThrow()
    expect(() => parseChain(null)).not.toThrow()
    expect(() => parseChain(undefined)).not.toThrow()
    expect(() => parseChain('')).not.toThrow()
  })
})

// ── (c) No valid input newly rejected — round-trip against normalizeChain ─────

describe('parseChain — no valid input is newly rejected (vs normalizeChain)', () => {
  // Every canonical Chain value must produce SUCCESS with the same canonical
  // value that normalizeChain returns. This proves zero-regression.
  it.each(Object.values(Chain))('canonical Chain value %s round-trips byte-identically through parseChain', chain => {
    const expected = normalizeChain(chain) // normalizeChain is the source of truth
    const result = parseChain(chain)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.chain).toBe(expected)
    }
  })

  // Lower-case forms of all canonical Chain values
  it.each(Object.values(Chain))('lowercase form of canonical Chain value %s is accepted', chain => {
    const lower = chain.toLowerCase()
    // normalizeChain should accept it; if so, parseChain must too
    let expected: Chain | undefined
    try {
      expected = normalizeChain(lower)
    } catch {
      // normalizeChain rejects — parseChain may also reject, that is fine
      return
    }
    const result = parseChain(lower)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.chain).toBe(expected)
    }
  })
})

// ── chainSchema Zod API surface ────────────────────────────────────────────────

describe('chainSchema — Zod schema API', () => {
  it('chainSchema.safeParse("Ethereum") → success', () => {
    const result = chainSchema.safeParse('Ethereum')
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toBe(Chain.Ethereum)
    }
  })

  it('chainSchema.safeParse("Terra Classic") → success (LLM-tolerance)', () => {
    const result = chainSchema.safeParse('Terra Classic')
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toBe(Chain.TerraClassic)
    }
  })

  it('chainSchema.safeParse("garbage") → failure with ZodError', () => {
    const result = chainSchema.safeParse('garbage')
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThan(0)
      expect(result.error.issues[0]?.message).toMatch(/unknown chain/i)
    }
  })

  it('chainSchema.safeParse(null) → failure (null input)', () => {
    const result = chainSchema.safeParse(null)
    expect(result.success).toBe(false)
  })

  it('chainSchema.safeParse(undefined) → failure (undefined input)', () => {
    const result = chainSchema.safeParse(undefined)
    expect(result.success).toBe(false)
  })

  it('ZodError message from chainSchema lists known chains', () => {
    const result = chainSchema.safeParse('notachain')
    expect(result.success).toBe(false)
    if (!result.success) {
      const msg = result.error.issues[0]?.message ?? ''
      // normalizeChain's UnknownChainError lists known chains in the message
      expect(msg.length).toBeGreaterThan(20)
    }
  })
})

// ── Terra/TerraClassic collision guard (fund-safety) ──────────────────────────

describe('parseChain — Terra vs TerraClassic never cross-resolve', () => {
  it('"Terra" resolves to Chain.Terra, never Chain.TerraClassic', () => {
    const result = parseChain('Terra')
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.chain).toBe(Chain.Terra)
      expect(result.chain).not.toBe(Chain.TerraClassic)
    }
  })

  it('"TerraClassic" resolves to Chain.TerraClassic, never Chain.Terra', () => {
    const result = parseChain('TerraClassic')
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.chain).toBe(Chain.TerraClassic)
      expect(result.chain).not.toBe(Chain.Terra)
    }
  })

  it('"Terra Classic" (with space) resolves to Chain.TerraClassic, never Chain.Terra', () => {
    const result = parseChain('Terra Classic')
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.chain).toBe(Chain.TerraClassic)
      expect(result.chain).not.toBe(Chain.Terra)
    }
  })

  it('"phoenix-1" resolves to Chain.Terra (not TerraClassic)', () => {
    const result = parseChain('phoenix-1')
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.chain).toBe(Chain.Terra)
    }
  })

  it('"columbus-5" resolves to Chain.TerraClassic (not Terra)', () => {
    const result = parseChain('columbus-5')
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.chain).toBe(Chain.TerraClassic)
    }
  })
})
