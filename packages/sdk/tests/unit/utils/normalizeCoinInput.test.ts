import { Chain } from '@vultisig/core-chain/Chain'
import { describe, expect, it } from 'vitest'

import { normalizeAccountCoin } from '../../../src/utils/normalizeCoinInput'
import { VaultError, VaultErrorCode } from '../../../src/vault/VaultError'

const eth = { chain: Chain.Ethereum, address: '0xsender', ticker: 'ETH', decimals: 18 }

const thrown = (input: unknown) => {
  try {
    normalizeAccountCoin(input)
  } catch (error) {
    return error
  }
  throw new Error('expected normalizeAccountCoin to throw')
}

describe('normalizeAccountCoin error messages', () => {
  it('reports a bigint field value as InvalidConfig instead of a TypeError', () => {
    const error = thrown({ ...eth, decimals: 18n })
    expect(error).toBeInstanceOf(VaultError)
    expect(error).toMatchObject({ code: VaultErrorCode.InvalidConfig, message: expect.stringContaining('decimals') })
    expect((error as VaultError).message).toContain('got 18n')
  })

  it('reports a circular field value as InvalidConfig instead of a TypeError', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    const error = thrown({ ...eth, ticker: circular })
    expect(error).toBeInstanceOf(VaultError)
    expect(error).toMatchObject({ code: VaultErrorCode.InvalidConfig, message: expect.stringContaining('ticker') })
  })
})
