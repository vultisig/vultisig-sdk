import { Chain } from '@vultisig/core-chain/Chain'
import { describe, expect, it } from 'vitest'

import { normalizeChain } from '../../../src/utils/normalizeChain'

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
  })
})
