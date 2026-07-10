import { create } from '@bufbuild/protobuf'
import { SuiCoinSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { describe, expect, it } from 'vitest'

import {
  isSameSuiCoinType,
  selectSuiGasObject,
  selectSuiInputCoins,
  selectSuiPayloadCoins,
  suiNativeCoinType,
} from './suiCoinSelection'

const longNativeType = `0x${'0'.repeat(63)}2::sui::SUI`
const tokenType = '0xabc::coin::USDC'

const coin = (id: string, balance: string, coinType = suiNativeCoinType) =>
  create(SuiCoinSchema, {
    coinType,
    coinObjectId: id,
    version: '1',
    digest: `digest-${id}`,
    balance,
  })

describe('Sui coin selection', () => {
  it('normalizes short and long native coin types', () => {
    expect(isSameSuiCoinType(suiNativeCoinType, longNativeType)).toBe(true)
  })

  it('selects the fewest largest objects needed to cover the target', () => {
    const selected = selectSuiInputCoins([coin('small', '1'), coin('large', '10'), coin('medium', '4')], 11n)

    expect(selected.map(c => c.coinObjectId)).toEqual(['large', 'medium'])
  })

  it('uses object id as the deterministic tie-break for equal balances', () => {
    const selected = selectSuiInputCoins([coin('0xbbb', '5'), coin('0xaaa', '5')], 5n)

    expect(selected.map(c => c.coinObjectId)).toEqual(['0xaaa'])
  })

  it('caps selected input objects at 255', () => {
    const selected = selectSuiInputCoins(
      Array.from({ length: 800 }, (_, index) => coin(`0x${index.toString().padStart(4, '0')}`, '1')),
      800n
    )

    expect(selected).toHaveLength(255)
  })

  it('selects the smallest native gas object that covers the gas budget', () => {
    const selected = selectSuiGasObject([coin('too-small', '10'), coin('large', '100'), coin('small-cover', '30')], 20n)

    expect(selected?.coinObjectId).toBe('small-cover')
  })

  it('falls back to the largest native gas object when none covers the budget', () => {
    const selected = selectSuiGasObject([coin('small', '10'), coin('large', '30')], 100n)

    expect(selected?.coinObjectId).toBe('large')
  })

  it('bounds native payload coins to amount plus gas budget', () => {
    const selected = selectSuiPayloadCoins({
      coins: [coin('dust', '1'), coin('covering', '20'), coin('other', '5', tokenType)],
      isNativeToken: true,
      amount: 12n,
      gasBudget: 3n,
    })

    expect(selected.map(c => c.coinObjectId)).toEqual(['covering'])
  })

  it('embeds token inputs plus the five largest native gas candidates for token sends', () => {
    const nativeCoins = Array.from({ length: 7 }, (_, index) => coin(`gas-${index}`, String(index + 1)))
    const tokenCoins = [coin('token-small', '1', tokenType), coin('token-cover', '10', tokenType)]

    const selected = selectSuiPayloadCoins({
      coins: [...nativeCoins, ...tokenCoins],
      isNativeToken: false,
      coinType: tokenType,
      amount: 10n,
      gasBudget: 3n,
    })

    expect(selected.map(c => c.coinObjectId)).toEqual(['token-cover', 'gas-6', 'gas-5', 'gas-4', 'gas-3', 'gas-2'])
  })
})
