import { Chain } from '@vultisig/core-chain/Chain'
import { describe, expect, it } from 'vitest'

import { assertValidChain } from '@/utils/chainValidation'
import { VaultError, VaultErrorCode } from '@/vault/VaultError'

describe('assertValidChain', () => {
  it('accepts a supported chain value', () => {
    expect(() => assertValidChain(Chain.Ethereum)).not.toThrow()
  })

  it('throws InvalidConfig when the string matches an enum key but not the canonical value', () => {
    // Chain enum uses BitcoinCash = 'Bitcoin-Cash' — passing the key name is invalid.
    expect(() => assertValidChain('BitcoinCash' as Chain)).toThrow(VaultError)
    try {
      assertValidChain('BitcoinCash' as Chain)
    } catch (e) {
      expect(e).toBeInstanceOf(VaultError)
      expect((e as VaultError).code).toBe(VaultErrorCode.InvalidConfig)
      expect((e as VaultError).message).toContain('Use Chain.BitcoinCash')
      expect((e as VaultError).message).toContain('Bitcoin-Cash')
    }
  })

  it('throws InvalidConfig for an unknown chain string', () => {
    expect(() => assertValidChain('NotARealChain' as Chain)).toThrow(VaultError)
    try {
      assertValidChain('NotARealChain' as Chain)
    } catch (e) {
      expect(e).toBeInstanceOf(VaultError)
      expect((e as VaultError).code).toBe(VaultErrorCode.InvalidConfig)
      expect((e as VaultError).message).toContain('Unknown chain')
    }
  })
})
