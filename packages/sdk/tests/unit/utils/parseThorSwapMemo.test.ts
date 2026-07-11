import { describe, expect, it } from 'vitest'

import { Chain } from '@/types'
import { parseThorSwapMemo } from '@/utils/thorSwapMemo'
import { VaultError, VaultErrorCode } from '@/vault/VaultError'

describe('parseThorSwapMemo', () => {
  describe('full notation', () => {
    it('parses XRP.XRP with destination + v0 + slippage', () => {
      const parsed = parseThorSwapMemo('=:XRP.XRP:rf7SyXdM3aZqkz9bmgGgX6V3eC8oJ8wxYY::v0:50')
      expect(parsed.destChainCode).toBe('XRP')
      expect(parsed.destAsset).toBe('XRP')
      expect(parsed.destAddress).toBe('rf7SyXdM3aZqkz9bmgGgX6V3eC8oJ8wxYY')
      expect(parsed.toChain).toBe(Chain.Ripple)
    })

    it('parses ETH.ETH', () => {
      const parsed = parseThorSwapMemo('=:ETH.ETH:0xabc::v0:50')
      expect(parsed.destChainCode).toBe('ETH')
      expect(parsed.destAsset).toBe('ETH')
      expect(parsed.destAddress).toBe('0xabc')
      expect(parsed.toChain).toBe(Chain.Ethereum)
    })

    it('strips ERC-20 contract suffix from destAsset (ETH.USDC-0X...)', () => {
      const parsed = parseThorSwapMemo('=:ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48:0xabc::v0:50')
      expect(parsed.destChainCode).toBe('ETH')
      expect(parsed.destAsset).toBe('USDC')
      expect(parsed.destAddress).toBe('0xabc')
      expect(parsed.toChain).toBe(Chain.Ethereum)
    })

    it('accepts memo without slippage suffix', () => {
      const parsed = parseThorSwapMemo('=:BTC.BTC:bc1qzmsk98gqtfvxhfrye8p7xkxlj6g9q6a2yj3yj2')
      expect(parsed.destChainCode).toBe('BTC')
      expect(parsed.destAsset).toBe('BTC')
      expect(parsed.destAddress).toBe('bc1qzmsk98gqtfvxhfrye8p7xkxlj6g9q6a2yj3yj2')
      expect(parsed.toChain).toBe(Chain.Bitcoin)
    })

    it('returns empty destAddress when memo omits it', () => {
      const parsed = parseThorSwapMemo('=:XRP.XRP')
      expect(parsed.destAddress).toBe('')
      expect(parsed.toChain).toBe(Chain.Ripple)
    })
  })

  describe('shorthand notation', () => {
    it('expands x → XRP.XRP', () => {
      const parsed = parseThorSwapMemo('=:x:rf7SyXdM3aZqkz9bmgGgX6V3eC8oJ8wxYY::v0:50')
      expect(parsed.destChainCode).toBe('XRP')
      expect(parsed.destAsset).toBe('XRP')
      expect(parsed.destAddress).toBe('rf7SyXdM3aZqkz9bmgGgX6V3eC8oJ8wxYY')
      expect(parsed.toChain).toBe(Chain.Ripple)
    })

    it('expands b → BTC.BTC, e → ETH.ETH, a → AVAX.AVAX, s → BSC.BNB', () => {
      expect(parseThorSwapMemo('=:b:bc1q').destChainCode).toBe('BTC')
      expect(parseThorSwapMemo('=:e:0xabc').destChainCode).toBe('ETH')
      expect(parseThorSwapMemo('=:a:0xabc').destChainCode).toBe('AVAX')
      expect(parseThorSwapMemo('=:s:0xabc').destChainCode).toBe('BSC')
      expect(parseThorSwapMemo('=:s:0xabc').destAsset).toBe('BNB')
    })

    it('expands multi-char shortcuts cacao / dash / zec', () => {
      expect(parseThorSwapMemo('=:cacao:maya1abc').destChainCode).toBe('MAYA')
      expect(parseThorSwapMemo('=:cacao:maya1abc').destAsset).toBe('CACAO')
      expect(parseThorSwapMemo('=:dash:Xab').destChainCode).toBe('DASH')
      expect(parseThorSwapMemo('=:zec:zab').destChainCode).toBe('ZEC')
    })

    it('expands g → GAIA.ATOM (Cosmos)', () => {
      const parsed = parseThorSwapMemo('=:g:cosmos1abc')
      expect(parsed.destChainCode).toBe('GAIA')
      expect(parsed.destAsset).toBe('ATOM')
      expect(parsed.toChain).toBe(Chain.Cosmos)
    })

    it('is case-insensitive for shortcuts', () => {
      expect(parseThorSwapMemo('=:X:rf7Sy').destChainCode).toBe('XRP')
      expect(parseThorSwapMemo('=:B:bc1q').destChainCode).toBe('BTC')
    })
  })

  describe('error paths', () => {
    it('throws NotImplemented for LP add memos (+:POOL)', () => {
      try {
        parseThorSwapMemo('+:BTC.BTC')
        expect.fail('expected throw')
      } catch (err) {
        expect(err).toBeInstanceOf(VaultError)
        expect((err as VaultError).code).toBe(VaultErrorCode.NotImplemented)
      }
    })

    it('throws NotImplemented for LP remove memos (-:POOL:BPS)', () => {
      expect(() => parseThorSwapMemo('-:BTC.BTC:5000')).toThrow(VaultError)
    })

    it('throws NotImplemented for bond / unbond / leave memos', () => {
      expect(() => parseThorSwapMemo('BOND:thor1abc')).toThrow(VaultError)
      expect(() => parseThorSwapMemo('UNBOND:thor1abc:1000')).toThrow(VaultError)
    })

    it('throws NotImplemented on empty memo', () => {
      expect(() => parseThorSwapMemo('')).toThrow(/only swap memos/)
    })

    it('throws InvalidConfig when unknown short prefix is used with no dot', () => {
      try {
        parseThorSwapMemo('=:zz:dest')
        expect.fail('expected throw')
      } catch (err) {
        expect(err).toBeInstanceOf(VaultError)
        expect((err as VaultError).code).toBe(VaultErrorCode.InvalidConfig)
      }
    })

    it('throws InvalidConfig when first segment is empty', () => {
      expect(() => parseThorSwapMemo('=:::')).toThrow(/missing CHAIN.ASSET/)
    })

    it('throws UnsupportedChain when the memo chain code has no SDK mapping', () => {
      try {
        parseThorSwapMemo('=:FOO.BAR:dest')
        expect.fail('expected throw')
      } catch (err) {
        expect(err).toBeInstanceOf(VaultError)
        expect((err as VaultError).code).toBe(VaultErrorCode.UnsupportedChain)
      }
    })

    it('throws VaultError instances (typed) for downstream consumers', () => {
      try {
        parseThorSwapMemo('=:FOO.BAR:dest')
        expect.fail('expected throw')
      } catch (err) {
        expect(err).toBeInstanceOf(VaultError)
        const code = (err as VaultError).code
        expect([
          VaultErrorCode.InvalidConfig,
          VaultErrorCode.NotImplemented,
          VaultErrorCode.UnsupportedChain,
        ]).toContain(code)
      }
    })
  })
})
