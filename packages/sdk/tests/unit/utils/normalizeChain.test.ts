import { Chain } from '@vultisig/core-chain/Chain'
import { describe, expect, it } from 'vitest'

import { normalizeChain, UnknownChainError } from '../../../src/utils/normalizeChain'

describe('normalizeChain', () => {
  describe('canonical Chain values (case-insensitive)', () => {
    it.each([
      ['Bitcoin', Chain.Bitcoin],
      ['bitcoin', Chain.Bitcoin],
      ['BITCOIN', Chain.Bitcoin],
      ['Ethereum', Chain.Ethereum],
      ['ethereum', Chain.Ethereum],
      ['ETHEREUM', Chain.Ethereum],
      ['Solana', Chain.Solana],
      ['SOLANA', Chain.Solana],
      ['BSC', Chain.BSC],
      ['bsc', Chain.BSC],
      ['Polygon', Chain.Polygon],
      ['Arbitrum', Chain.Arbitrum],
      ['Optimism', Chain.Optimism],
      ['Avalanche', Chain.Avalanche],
      ['Base', Chain.Base],
      ['Blast', Chain.Blast],
      ['Mantle', Chain.Mantle],
      ['Zksync', Chain.Zksync],
      ['ZKSYNC', Chain.Zksync],
      ['CronosChain', Chain.CronosChain],
      ['cronoschain', Chain.CronosChain],
      ['Hyperliquid', Chain.Hyperliquid],
      ['Sei', Chain.Sei],
      ['Dogecoin', Chain.Dogecoin],
      ['Litecoin', Chain.Litecoin],
      ['Dash', Chain.Dash],
      ['Zcash', Chain.Zcash],
      ['THORChain', Chain.THORChain],
      ['thorchain', Chain.THORChain],
      ['MayaChain', Chain.MayaChain],
      ['Cosmos', Chain.Cosmos],
      ['Osmosis', Chain.Osmosis],
      ['Ripple', Chain.Ripple],
      ['Sui', Chain.Sui],
      ['Ton', Chain.Ton],
      ['Polkadot', Chain.Polkadot],
      ['Bittensor', Chain.Bittensor],
      ['Cardano', Chain.Cardano],
      ['Tron', Chain.Tron],
      ['Kujira', Chain.Kujira],
      ['Terra', Chain.Terra],
      ['TerraClassic', Chain.TerraClassic],
      ['Noble', Chain.Noble],
      ['Akash', Chain.Akash],
      ['Dydx', Chain.Dydx],
      ['QBTC', Chain.QBTC],
    ])('resolves canonical "%s" to %s', (input, expected) => {
      expect(normalizeChain(input)).toBe(expected)
    })

    it('resolves Bitcoin-Cash canonical value (hyphenated)', () => {
      expect(normalizeChain('Bitcoin-Cash')).toBe(Chain.BitcoinCash)
      expect(normalizeChain('bitcoin-cash')).toBe(Chain.BitcoinCash)
      expect(normalizeChain('BITCOIN-CASH')).toBe(Chain.BitcoinCash)
    })
  })

  describe('common aliases', () => {
    it.each([
      ['btc', Chain.Bitcoin],
      ['BTC', Chain.Bitcoin],
      ['Bitcoin', Chain.Bitcoin],
      ['bitcoin', Chain.Bitcoin],
      ['eth', Chain.Ethereum],
      ['ETH', Chain.Ethereum],
      ['ethereum', Chain.Ethereum],
      ['sol', Chain.Solana],
      ['SOL', Chain.Solana],
      ['solana', Chain.Solana],
      ['bnb', Chain.BSC],
      ['BNB', Chain.BSC],
      ['bsc', Chain.BSC],
      ['binance', Chain.BSC],
      ['binancesmartchain', Chain.BSC],
      ['BinanceSmartChain', Chain.BSC],
      ['matic', Chain.Polygon],
      ['MATIC', Chain.Polygon],
      ['polygon', Chain.Polygon],
      ['arb', Chain.Arbitrum],
      ['ARB', Chain.Arbitrum],
      ['arbitrum', Chain.Arbitrum],
      ['op', Chain.Optimism],
      ['OP', Chain.Optimism],
      ['optimism', Chain.Optimism],
      ['avax', Chain.Avalanche],
      ['AVAX', Chain.Avalanche],
      ['avalanche', Chain.Avalanche],
      ['doge', Chain.Dogecoin],
      ['DOGE', Chain.Dogecoin],
      ['dogecoin', Chain.Dogecoin],
      ['ltc', Chain.Litecoin],
      ['LTC', Chain.Litecoin],
      ['litecoin', Chain.Litecoin],
      ['bch', Chain.BitcoinCash],
      ['BCH', Chain.BitcoinCash],
      ['bitcoincash', Chain.BitcoinCash],
      ['BitcoinCash', Chain.BitcoinCash],
      ['thor', Chain.THORChain],
      ['THOR', Chain.THORChain],
      ['thorchain', Chain.THORChain],
      ['rune', Chain.THORChain],
      ['RUNE', Chain.THORChain],
      ['xrp', Chain.Ripple],
      ['XRP', Chain.Ripple],
      ['ripple', Chain.Ripple],
      ['maya', Chain.MayaChain],
      ['MAYA', Chain.MayaChain],
      ['mayachain', Chain.MayaChain],
      ['atom', Chain.Cosmos],
      ['ATOM', Chain.Cosmos],
      ['cosmos', Chain.Cosmos],
      ['osmo', Chain.Osmosis],
      ['osmosis', Chain.Osmosis],
      ['sui', Chain.Sui],
      ['ton', Chain.Ton],
      ['dot', Chain.Polkadot],
      ['polkadot', Chain.Polkadot],
      ['tao', Chain.Bittensor],
      ['bittensor', Chain.Bittensor],
      ['ada', Chain.Cardano],
      ['cardano', Chain.Cardano],
      ['trx', Chain.Tron],
      ['tron', Chain.Tron],
      ['zec', Chain.Zcash],
      ['zcash', Chain.Zcash],
      ['dash', Chain.Dash],
      ['base', Chain.Base],
      ['blast', Chain.Blast],
      ['zksync', Chain.Zksync],
      ['zk', Chain.Zksync],
      ['mnt', Chain.Mantle],
      ['mantle', Chain.Mantle],
      ['cro', Chain.CronosChain],
      ['cronos', Chain.CronosChain],
      ['hype', Chain.Hyperliquid],
      ['hyperliquid', Chain.Hyperliquid],
      ['sei', Chain.Sei],
      ['dydx', Chain.Dydx],
      ['DYDX', Chain.Dydx],
    ])('resolves alias "%s" to %s', (input, expected) => {
      expect(normalizeChain(input)).toBe(expected)
    })
  })

  describe('whitespace handling', () => {
    it('trims leading and trailing whitespace', () => {
      expect(normalizeChain('  bitcoin  ')).toBe(Chain.Bitcoin)
      expect(normalizeChain('\tETH\n')).toBe(Chain.Ethereum)
    })
  })

  describe('error cases', () => {
    it('throws a descriptive error for unknown chain', () => {
      expect(() => normalizeChain('foo')).toThrow(/Unknown chain "foo"/)
    })

    it('error lists known chains', () => {
      try {
        normalizeChain('notachain')
        expect.unreachable('should have thrown')
      } catch (e) {
        const msg = (e as Error).message
        expect(msg).toContain('bitcoin')
        expect(msg).toContain('ethereum')
        expect(msg).toContain('solana')
      }
    })

    it('throws for empty string', () => {
      expect(() => normalizeChain('')).toThrow(/Unknown chain/)
    })

    it('throws for whitespace-only string', () => {
      expect(() => normalizeChain('   ')).toThrow(/Unknown chain/)
    })

    it('throws UnknownChainError for null input', () => {
      expect(() => normalizeChain(null)).toThrow(UnknownChainError)
    })

    it('throws UnknownChainError for undefined input', () => {
      expect(() => normalizeChain(undefined)).toThrow(UnknownChainError)
    })
  })

  describe('coin-vs-chain disambiguation (priceProviderId no longer auto-derived)', () => {
    // priceProviderId used to be auto-aliased, which conflated coins with chains.
    // e.g. Noble's priceProviderId is "usd-coin" — but USDC is a coin that lives on
    // many chains, so resolving "usd-coin" to Chain.Noble was misleading.
    it('does not resolve "usd-coin" (Noble priceProviderId)', () => {
      expect(() => normalizeChain('usd-coin')).toThrow(UnknownChainError)
    })

    it('does not resolve "bitcoin-cash" via priceProviderId (but the canonical enum still resolves it)', () => {
      // The canonical Chain enum value Bitcoin-Cash still resolves (layer 3).
      expect(normalizeChain('bitcoin-cash')).toBe(Chain.BitcoinCash)
    })

    // USDC is Noble's native ticker, so ticker-based derivation still resolves it
    // to Chain.Noble. Documented tradeoff: the ticker is genuinely Noble's, even
    // though USDC as an ERC-20 also lives on many EVM chains.
    it('resolves "usdc" to Chain.Noble via ticker (Noble fee-coin ticker)', () => {
      expect(normalizeChain('usdc')).toBe(Chain.Noble)
    })
  })

  // Consolidated from agent-backend-ts's zodHelpers.ts chainString() — the fix for the
  // LUNA<->LUNC "no route" bug (deepseek emits `to_chain: "Terra Classic"` with a space
  // ~2/3 of the time, which the pre-consolidation SDK rejected outright). These natural-
  // language, space/underscore/hyphen-insensitive forms must resolve WITHOUT any caller-side
  // fallback layer — the SDK is now the single source of this tolerance.
  describe('separator-insensitive natural-language phrasings (LLM tolerance)', () => {
    it.each([
      ['Terra Classic', Chain.TerraClassic],
      ['terra classic', Chain.TerraClassic],
      ['TERRA CLASSIC', Chain.TerraClassic],
      ['terra_classic', Chain.TerraClassic],
      ['terra-classic', Chain.TerraClassic],
      ['Bitcoin Cash', Chain.BitcoinCash],
      ['bitcoin cash', Chain.BitcoinCash],
      ['BITCOIN CASH', Chain.BitcoinCash],
      ['bitcoin_cash', Chain.BitcoinCash],
      ['Cronos Chain', Chain.CronosChain],
      ['cronos chain', Chain.CronosChain],
      ['THOR Chain', Chain.THORChain],
      ['thor chain', Chain.THORChain],
      ['Thor Chain', Chain.THORChain],
      ['ZK Sync', Chain.Zksync],
      ['zk sync', Chain.Zksync],
      ['Maya Chain', Chain.MayaChain],
      ['maya chain', Chain.MayaChain],
      ['Binance Smart Chain', Chain.BSC],
      ['binance smart chain', Chain.BSC],
    ])('resolves separator-insensitive "%s" to %s', (input, expected) => {
      expect(normalizeChain(input)).toBe(expected)
    })

    it('still resolves the exact hyphenated canonical form directly (no regression)', () => {
      expect(normalizeChain('Bitcoin-Cash')).toBe(Chain.BitcoinCash)
    })

    it('still resolves the un-spaced hand-curated alias directly (no regression)', () => {
      expect(normalizeChain('bitcoincash')).toBe(Chain.BitcoinCash)
      expect(normalizeChain('binancesmartchain')).toBe(Chain.BSC)
    })

    it('tolerates surrounding whitespace combined with internal separators', () => {
      expect(normalizeChain('  Terra Classic  ')).toBe(Chain.TerraClassic)
      expect(normalizeChain('\tBitcoin Cash\n')).toBe(Chain.BitcoinCash)
    })
  })

  // Chain-id / marketing-name aliases (agent-backend-ts CHAIN_ALIAS_TABLE): these carry no
  // separator-free form anywhere in the existing alias/ticker/canonical tables, so they are
  // hand-curated additions, not a side effect of separator-stripping alone.
  describe('chain-id / marketing-name aliases', () => {
    it.each([
      ['cosmoshub-4', Chain.Cosmos],
      ['gaia', Chain.Cosmos],
      ['osmosis-1', Chain.Osmosis],
      ['thorchain-1', Chain.THORChain],
      ['mayachain-mainnet-v1', Chain.MayaChain],
      ['dydx-mainnet-1', Chain.Dydx],
      ['kaiyo-1', Chain.Kujira],
      ['columbus-5', Chain.TerraClassic],
      ['columbus5', Chain.TerraClassic],
      ['Columbus-5', Chain.TerraClassic],
      ['COLUMBUS-5', Chain.TerraClassic],
      ['phoenix-1', Chain.Terra],
      ['phoenix1', Chain.Terra],
      ['noble-1', Chain.Noble],
      ['akashnet-2', Chain.Akash],
      ['Phoenix-1', Chain.Terra],
      ['terra v2', Chain.Terra],
      ['Terra V2', Chain.Terra],
      ['TERRA V2', Chain.Terra],
      ['terra-v2', Chain.Terra],
      ['terra_v2', Chain.Terra],
      ['terrav2', Chain.Terra],
      ['cosmos hub', Chain.Cosmos],
      ['Cosmos Hub', Chain.Cosmos],
      ['gaia', Chain.Cosmos],
      ['GAIA', Chain.Cosmos],
      ['ustc', Chain.TerraClassic],
      ['USTC', Chain.TerraClassic],
      ['bnb smart chain', Chain.BSC],
      ['BNB Smart Chain', Chain.BSC],
      ['bnb chain', Chain.BSC],
      ['BSC-MAINNET', Chain.BSC],
      ['arbitrum one', Chain.Arbitrum],
      ['Arbitrum One', Chain.Arbitrum],
      ['ethereum-mainnet', Chain.Ethereum],
      ['Ethereum Mainnet', Chain.Ethereum],
    ])('resolves chain-id/marketing alias "%s" to %s', (input, expected) => {
      expect(normalizeChain(input)).toBe(expected)
    })

    it('does not conflate Terra v2 aliases with Terra Classic (fund-safety: distinct chains, shared address)', () => {
      expect(normalizeChain('phoenix-1')).not.toBe(Chain.TerraClassic)
      expect(normalizeChain('terra v2')).not.toBe(Chain.TerraClassic)
      expect(normalizeChain('columbus-5')).not.toBe(Chain.Terra)
    })
  })

  // Fund-safety guard: a wrong collision here could misroute a swap/send to the wrong chain.
  // Every canonical Chain value's own separator-stripped form must resolve to ITSELF, never to
  // a different chain — proves the auto-derived stripped-alias table never cross-wires two
  // distinct chains that happen to share a stripped form.
  describe('collision guard — every known chain resolves to itself, never another chain', () => {
    it.each(Object.values(Chain))('canonical value %s round-trips to itself', chain => {
      expect(normalizeChain(chain)).toBe(chain)
      expect(normalizeChain(chain.toLowerCase())).toBe(chain)
      expect(normalizeChain(chain.toUpperCase())).toBe(chain)
    })

    it('Terra and TerraClassic never resolve to each other despite sharing an address/name prefix', () => {
      expect(normalizeChain('Terra')).toBe(Chain.Terra)
      expect(normalizeChain('Terra')).not.toBe(Chain.TerraClassic)
      expect(normalizeChain('TerraClassic')).toBe(Chain.TerraClassic)
      expect(normalizeChain('TerraClassic')).not.toBe(Chain.Terra)
      expect(normalizeChain('Terra Classic')).toBe(Chain.TerraClassic)
      expect(normalizeChain('Terra Classic')).not.toBe(Chain.Terra)
    })
  })

  describe('error cases (separator-stripped fallback)', () => {
    it('still throws for a genuinely unknown space-separated phrase', () => {
      expect(() => normalizeChain('not a real chain')).toThrow(UnknownChainError)
    })

    it('still throws for a partial/ambiguous fragment', () => {
      expect(() => normalizeChain('terra classic 2')).toThrow(UnknownChainError)
    })
  })
})
