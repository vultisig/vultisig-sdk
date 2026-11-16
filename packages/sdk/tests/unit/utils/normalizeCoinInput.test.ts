import { Chain } from '@vultisig/core-chain/Chain'
import { describe, expect, it } from 'vitest'

import { normalizeAccountCoin, normalizeCoinInput } from '../../../src/utils/normalizeCoinInput'
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

describe('coin compatibility and validation', () => {
  it.each(['', '  ', null, undefined])('treats contractAddress %j as absent and strips metadata', contractAddress => {
    const input = { ...eth, contractAddress, isNativeToken: true }
    expect(normalizeAccountCoin(input)).toEqual(eth)
    expect(input).toEqual({ ...eth, contractAddress, isNativeToken: true })
  })

  it('strips metadata without changing a token or mutating its input', () => {
    const input = { ...eth, contractAddress: '0xtoken', isNativeToken: false }
    expect(normalizeAccountCoin(input)).toEqual({ ...eth, id: '0xtoken' })
    expect(input.isNativeToken).toBe(false)
    expect(input).not.toHaveProperty('id')
  })

  it.each(['contract', 'tokenAddress', 'token', 'mint', 'denom', 'assetId'])('rejects asset identifier %s', key => {
    expect(thrown({ ...eth, [key]: '0xtoken' })).toMatchObject({
      code: VaultErrorCode.InvalidConfig,
      message: expect.stringContaining(key),
    })
  })

  it('rejects a native flag conflicting with a contract', () => {
    expect(thrown({ ...eth, contractAddress: '0xtoken', isNativeToken: true })).toMatchObject({
      code: VaultErrorCode.InvalidConfig,
      message: expect.stringContaining('isNativeToken'),
    })
  })

  it.each(['', '  ', null, undefined])('treats id %j as absent', id => {
    const input = { ...eth, priceProviderId: '', logo: '', isHidden: false, id }
    const result = normalizeAccountCoin(input)
    expect(result).toEqual({ ...eth, priceProviderId: '', logo: '', isHidden: false })
    expect(result).not.toHaveProperty('id')
    expect(input).toEqual({ ...eth, priceProviderId: '', logo: '', isHidden: false, id })
  })

  it.each(['id', 'contractAddress'])('accepts a native flag with blank %s', key => {
    const result = normalizeAccountCoin({ ...eth, isNativeToken: true, [key]: '' })
    expect(result).toEqual(eth)
    expect(result).not.toHaveProperty('id')
  })

  it.each([
    ['priceProviderId', 1],
    ['logo', false],
    ['isHidden', 'true'],
  ])('rejects the wrong type for %s', (key, value) => {
    expect(thrown({ ...eth, [key]: value })).toMatchObject({
      code: VaultErrorCode.InvalidConfig,
      message: expect.stringContaining(key),
    })
  })

  it('preserves correctly typed optional metadata', () => {
    const coin = { ...eth, priceProviderId: '', logo: '', isHidden: false }
    expect(normalizeAccountCoin(coin)).toEqual(coin)
  })

  it('rejects the zero address in a simple token input', () => {
    const input = { chain: Chain.Ethereum, token: '0x0000000000000000000000000000000000000000' }
    expect(() => normalizeCoinInput(input)).toThrow(VaultError)
    expect(() => normalizeCoinInput(input)).toThrow(
      expect.objectContaining({
        code: VaultErrorCode.InvalidConfig,
        message: expect.stringContaining('token'),
      })
    )
  })
})
