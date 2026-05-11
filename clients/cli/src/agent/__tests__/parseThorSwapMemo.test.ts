/**
 * Phase D — THORChain swap-memo parser tests.
 *
 * Validates `parseThorSwapMemo` extracts CHAIN.ASSET + destination address
 * from THORChain swap memos, including the abbreviated asset notation
 * documented at https://docs.thorchain.org/concepts/asset-notation#asset-shorthand.
 *
 * The parser is exercised by `signThorMsgDepositSwap` on the
 * THORChain/MayaChain MsgDeposit branch — its outputs feed both the
 * vault.swap dispatch (destChainCode → Chain enum) and the fund-safety
 * guard that compares `destAddress` against the vault's own destination
 * address before broadcasting.
 */
import { VaultError, VaultErrorCode } from '@vultisig/sdk'
import { describe, expect, it } from 'vitest'

import { parseThorSwapMemo } from '../executor'

describe('parseThorSwapMemo', () => {
  describe('full notation', () => {
    it('parses XRP.XRP with destination + v0 + slippage', () => {
      const parsed = parseThorSwapMemo('=:XRP.XRP:rf7SyXdM3aZqkz9bmgGgX6V3eC8oJ8wxYY::v0:50')
      expect(parsed.destChainCode).toBe('XRP')
      expect(parsed.destAsset).toBe('XRP')
      expect(parsed.destAddress).toBe('rf7SyXdM3aZqkz9bmgGgX6V3eC8oJ8wxYY')
    })

    it('parses ETH.ETH', () => {
      const parsed = parseThorSwapMemo('=:ETH.ETH:0xabc::v0:50')
      expect(parsed.destChainCode).toBe('ETH')
      expect(parsed.destAsset).toBe('ETH')
      expect(parsed.destAddress).toBe('0xabc')
    })

    it('strips ERC-20 contract suffix from destAsset (ETH.USDC-0X...)', () => {
      const parsed = parseThorSwapMemo('=:ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48:0xabc::v0:50')
      expect(parsed.destChainCode).toBe('ETH')
      expect(parsed.destAsset).toBe('USDC')
      expect(parsed.destAddress).toBe('0xabc')
    })

    it('accepts memo without slippage suffix', () => {
      const parsed = parseThorSwapMemo('=:BTC.BTC:bc1qzmsk98gqtfvxhfrye8p7xkxlj6g9q6a2yj3yj2')
      expect(parsed.destChainCode).toBe('BTC')
      expect(parsed.destAsset).toBe('BTC')
      expect(parsed.destAddress).toBe('bc1qzmsk98gqtfvxhfrye8p7xkxlj6g9q6a2yj3yj2')
    })

    it('returns empty destAddress when memo omits it', () => {
      const parsed = parseThorSwapMemo('=:XRP.XRP')
      expect(parsed.destAddress).toBe('')
    })
  })

  describe('shorthand notation', () => {
    it('expands x → XRP.XRP', () => {
      const parsed = parseThorSwapMemo('=:x:rf7SyXdM3aZqkz9bmgGgX6V3eC8oJ8wxYY::v0:50')
      expect(parsed.destChainCode).toBe('XRP')
      expect(parsed.destAsset).toBe('XRP')
      expect(parsed.destAddress).toBe('rf7SyXdM3aZqkz9bmgGgX6V3eC8oJ8wxYY')
    })

    it('expands b → BTC.BTC, e → ETH.ETH, a → AVAX.AVAX, s → BSC.BNB', () => {
      expect(parseThorSwapMemo('=:b:bc1q').destChainCode).toBe('BTC')
      expect(parseThorSwapMemo('=:e:0xabc').destChainCode).toBe('ETH')
      expect(parseThorSwapMemo('=:a:0xabc').destChainCode).toBe('AVAX')
      expect(parseThorSwapMemo('=:s:0xabc').destChainCode).toBe('BSC')
      // BSC.BNB → destAsset is 'BNB' (BSC chain, BNB token).
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
    })

    it('is case-insensitive for shortcuts', () => {
      // memos are typically lowercase but the parser normalises before lookup.
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

    it('throws NotImplemented on empty memo (so signThorMsgDepositSwap rejects bare-MsgDeposit envelopes)', () => {
      expect(() => parseThorSwapMemo('')).toThrow(/only swap memos/)
    })

    it('throws InvalidConfig when unknown short prefix is used with no dot', () => {
      // `=:zz:dest` — `zz` is not a known shortcut and doesn't contain `.`.
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

    it('throws VaultError instances (typed) for downstream normalizeAgentError', () => {
      try {
        parseThorSwapMemo('=:zz:dest')
        expect.fail('expected throw')
      } catch (err) {
        expect(err).toBeInstanceOf(VaultError)
        // Either InvalidConfig (malformed) or NotImplemented (non-swap).
        const code = (err as VaultError).code
        expect([VaultErrorCode.InvalidConfig, VaultErrorCode.NotImplemented]).toContain(code)
      }
    })
  })
})
