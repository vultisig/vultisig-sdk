/**
 * Sui bounded coin selection (sdk#1132) — parity with iOS #4734.
 *
 * The fixture tests mirror `SuiHelperInputDataTests.swift` from the iOS PR
 * (same coins, amounts, gas budgets, and expected selections) so the SDK's
 * `TW.Sui.Proto.SigningInput` references the identical object set iOS
 * references — the cross-device keysign consensus requirement.
 */

import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { TW } from '@trustwallet/wallet-core'
import Long from 'long'
import { describe, expect, it } from 'vitest'

import { SuiCoinSchema, SuiSpecificSchema } from '../../types/vultisig/keysign/v1/blockchain_specific_pb'
import { CoinSchema } from '../../types/vultisig/keysign/v1/coin_pb'
import { KeysignPayloadSchema } from '../../types/vultisig/keysign/v1/keysign_message_pb'
import { getSuiSigningInputs } from '../../keysign/signingInputs/resolvers/sui'
import {
  isNativeSuiCoinType,
  maxSuiInputCoinObjects,
  normalizeSuiCoinType,
  selectSuiGasObject,
  selectSuiInputCoins,
  selectSuiPayloadCoins,
  suiCoinTypesMatch,
  suiGasCandidateObjectCount,
} from './coinSelection'

// Long-form native type — exactly what `suix_getAllCoins` returns.
const NATIVE_TYPE = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI'
const TOKEN_TYPE = '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN'
const RECIPIENT = '0x51d5b8e2f3d2f0aef0aefdc4e6c0f4f3d2b1a09788c7e6f5d4c3b2a190817263'
const SENDER = '0x0000000000000000000000000000000000000000000000000000000000000abc'

const coinObject = (id: string, type: string, balance: string, version = '1') =>
  create(SuiCoinSchema, {
    coinObjectId: id,
    version,
    digest: `digest-${id}`,
    balance,
    coinType: type,
  })

const makePayload = ({
  isNative,
  coins,
  amount,
  gasBudget,
}: {
  isNative: boolean
  coins: ReturnType<typeof coinObject>[]
  amount: bigint
  gasBudget: bigint
}) =>
  create(KeysignPayloadSchema, {
    coin: create(CoinSchema, {
      chain: Chain.Sui,
      ticker: isNative ? 'SUI' : 'COIN',
      address: SENDER,
      decimals: isNative ? 9 : 8,
      isNativeToken: isNative,
      contractAddress: isNative ? '' : TOKEN_TYPE,
    }),
    toAddress: RECIPIENT,
    toAmount: amount.toString(),
    blockchainSpecific: {
      case: 'suicheSpecific',
      value: create(SuiSpecificSchema, {
        coins,
        referenceGasPrice: '1000',
        gasBudget: gasBudget.toString(),
      }),
    },
  })

// The sui resolver is synchronous; narrow the resolver-union return type.
const resolve = (payload: ReturnType<typeof makePayload>) =>
  getSuiSigningInputs({ keysignPayload: payload } as Parameters<
    typeof getSuiSigningInputs
  >[0]) as TW.Sui.Proto.SigningInput[]

describe('normalizeSuiCoinType / matching', () => {
  it('matches short and long package-address forms', () => {
    expect(suiCoinTypesMatch('0x2::sui::SUI', NATIVE_TYPE)).toBe(true)
    expect(isNativeSuiCoinType(NATIVE_TYPE)).toBe(true)
    expect(isNativeSuiCoinType('0x2::sui::SUI')).toBe(true)
  })

  it('is case-insensitive but exact on module/struct — look-alikes never match', () => {
    expect(isNativeSuiCoinType('0X2::SUI::sui')).toBe(true)
    expect(isNativeSuiCoinType('0xb45f::xsui::XSUI')).toBe(false)
    expect(suiCoinTypesMatch(TOKEN_TYPE, TOKEN_TYPE.toUpperCase())).toBe(true)
  })

  it('normalizes the address segment only', () => {
    expect(normalizeSuiCoinType('0x0002::sui::SUI')).toBe('0x2::sui::sui')
    expect(normalizeSuiCoinType('0x0::a::B')).toBe('0x0::a::b')
  })
})

describe('selectSuiInputCoins', () => {
  const coins = [
    coinObject('0xa', NATIVE_TYPE, '1000000000'),
    coinObject('0xb', NATIVE_TYPE, '2000000000'),
    coinObject('0xc', NATIVE_TYPE, '3000000000'),
  ]

  it('selects the fewest largest objects covering the target', () => {
    const selected = selectSuiInputCoins(coins, BigInt(4_003_000_000))
    expect(selected.map(c => c.coinObjectId)).toEqual(['0xc', '0xb'])
  })

  it('keeps at least one object for a zero-amount target', () => {
    const selected = selectSuiInputCoins(coins, BigInt(0))
    expect(selected.map(c => c.coinObjectId)).toEqual(['0xc'])
  })

  it('tie-breaks equal balances by objectID ascending (deterministic across devices)', () => {
    const tied = [coinObject('0xbeta', NATIVE_TYPE, '100'), coinObject('0xalpha', NATIVE_TYPE, '100')]
    const selected = selectSuiInputCoins(tied, BigInt(150))
    expect(selected.map(c => c.coinObjectId)).toEqual(['0xalpha', '0xbeta'])
  })

  it('caps at maxSuiInputCoinObjects even when the target is not reached', () => {
    const dust = Array.from({ length: 400 }, (_, i) => coinObject(`0xdust${i}`, NATIVE_TYPE, '1'))
    const selected = selectSuiInputCoins(dust, BigInt(1_000_000))
    expect(selected).toHaveLength(maxSuiInputCoinObjects)
  })
})

describe('selectSuiGasObject', () => {
  it('picks the smallest native object covering the budget', () => {
    const coins = [
      coinObject('0xsmall', NATIVE_TYPE, '500000'),
      coinObject('0xcovers', NATIVE_TYPE, '3000000'),
      coinObject('0xbig', NATIVE_TYPE, '9000000'),
    ]
    expect(selectSuiGasObject(coins, BigInt(3_000_000))?.coinObjectId).toBe('0xcovers')
  })

  it('falls back to the largest object when none covers (best effort, matches iOS #4734)', () => {
    const coins = [coinObject('0xsmall', NATIVE_TYPE, '1000'), coinObject('0xbigger', NATIVE_TYPE, '2000')]
    expect(selectSuiGasObject(coins, BigInt(3_000_000))?.coinObjectId).toBe('0xbigger')
  })

  it('returns undefined when the wallet holds no native SUI object', () => {
    expect(selectSuiGasObject([coinObject('0xt', TOKEN_TYPE, '100')], BigInt(1))).toBeUndefined()
  })
})

describe('selectSuiPayloadCoins', () => {
  it('native: embeds only the covering subset', () => {
    const coins = [
      coinObject('0xa', NATIVE_TYPE, '1000000000'),
      coinObject('0xb', NATIVE_TYPE, '2000000000'),
      coinObject('0xc', NATIVE_TYPE, '3000000000'),
      coinObject('0xmeme', '0xdead::meme::MEME', '999999999999'),
    ]
    const selected = selectSuiPayloadCoins({
      coins,
      contractAddress: '',
      amount: BigInt(4_000_000_000),
      gasBudget: BigInt(3_000_000),
    })
    expect(selected.map(c => c.coinObjectId)).toEqual(['0xc', '0xb'])
  })

  it('token: embeds covering token objects + the largest few native gas candidates', () => {
    const coins = [
      ...Array.from({ length: 10 }, (_, i) => coinObject(`0xgas${i}`, NATIVE_TYPE, `${(i + 1) * 1_000_000}`)),
      coinObject('0xt1', TOKEN_TYPE, '100'),
      coinObject('0xt2', TOKEN_TYPE, '200'),
      coinObject('0xmeme', '0xdead::meme::MEME', '999'),
    ]
    const selected = selectSuiPayloadCoins({
      coins,
      contractAddress: TOKEN_TYPE,
      amount: BigInt(250),
      gasBudget: BigInt(3_000_000),
    })
    const ids = selected.map(c => c.coinObjectId)
    expect(ids.slice(0, 2)).toEqual(['0xt2', '0xt1'])
    expect(ids).toHaveLength(2 + suiGasCandidateObjectCount)
    // Largest five gas objects survive as candidates; memecoin dropped.
    expect(ids).toContain('0xgas9')
    expect(ids).not.toContain('0xgas0')
    expect(ids).not.toContain('0xmeme')
  })
})

// ---------------------------------------------------------------------------
// SigningInput fixture parity — mirrors SuiHelperInputDataTests.swift (#4734)
// ---------------------------------------------------------------------------

describe('getSuiSigningInputs — native send merges the objects it needs (iOS #4734 fixtures)', () => {
  const nativeCoins = [
    coinObject('0xa', NATIVE_TYPE, '1000000000'),
    coinObject('0xb', NATIVE_TYPE, '2000000000'),
    coinObject('0xc', NATIVE_TYPE, '3000000000'),
  ]

  it('selects the largest objects covering amount + gas', () => {
    const [input] = resolve(
      makePayload({ isNative: true, coins: nativeCoins, amount: BigInt(4_000_000_000), gasBudget: BigInt(3_000_000) })
    )
    expect(new Set(input.paySui!.inputCoins!.map(c => c!.objectId))).toEqual(new Set(['0xc', '0xb']))
    expect(input.paySui!.amounts!.map(a => Long.fromValue(a!).toString())).toEqual(['4000000000'])
  })

  it('small send selects only the largest object', () => {
    const [input] = resolve(
      makePayload({ isNative: true, coins: nativeCoins, amount: BigInt(100_000_000), gasBudget: BigInt(3_000_000) })
    )
    expect(input.paySui!.inputCoins!.map(c => c!.objectId)).toEqual(['0xc'])
  })

  it('near-max send selects all objects', () => {
    const [input] = resolve(
      makePayload({ isNative: true, coins: nativeCoins, amount: BigInt(5_900_000_000), gasBudget: BigInt(3_000_000) })
    )
    expect(new Set(input.paySui!.inputCoins!.map(c => c!.objectId))).toEqual(new Set(['0xa', '0xb', '0xc']))
  })

  it('dusty wallet (800 objects) references only what it needs — bounded at 255', () => {
    const coins = [
      coinObject('0xbig', NATIVE_TYPE, '10000000000'),
      ...Array.from({ length: 800 }, (_, i) => coinObject(`0xdust${i}`, NATIVE_TYPE, '1000')),
    ]
    const [input] = resolve(
      makePayload({ isNative: true, coins, amount: BigInt(1_000_000_000), gasBudget: BigInt(3_000_000) })
    )
    expect(input.paySui!.inputCoins!.map(c => c!.objectId)).toEqual(['0xbig'])
    expect(input.paySui!.inputCoins!.length).toBeLessThanOrEqual(maxSuiInputCoinObjects)
  })

  it('look-alike objects (xSUI LST) are never passed as native inputs', () => {
    const coins = [
      coinObject('0xnative', NATIVE_TYPE, '5000000000'),
      coinObject('0xlst', '0xb45f::xsui::XSUI', '9000000000'),
    ]
    const [input] = resolve(
      makePayload({ isNative: true, coins, amount: BigInt(1_000_000_000), gasBudget: BigInt(3_000_000) })
    )
    expect(input.paySui!.inputCoins!.map(c => c!.objectId)).toEqual(['0xnative'])
  })

  it('long-form native coin types (as returned by suix_getAllCoins) are recognized', () => {
    // Pre-#1132 the resolver compared coinType with `===` against the short
    // form only, so a long-form-typed wallet produced EMPTY inputs.
    const coins = [coinObject('0xlong', NATIVE_TYPE, '5000000000')]
    const [input] = resolve(
      makePayload({ isNative: true, coins, amount: BigInt(1_000_000_000), gasBudget: BigInt(3_000_000) })
    )
    expect(input.paySui!.inputCoins!.map(c => c!.objectId)).toEqual(['0xlong'])
  })
})

describe('getSuiSigningInputs — token send selects a covering gas object (iOS #4734 fixtures)', () => {
  it('picks the smallest covering gas object, not the first RPC object', () => {
    const coins = [
      // First SUI object is too small to pay gas — the old `gasCoins[0]` pick.
      coinObject('0xgasTooSmall', NATIVE_TYPE, '500000'),
      coinObject('0xgasCovers', NATIVE_TYPE, '3000000'),
      coinObject('0xgasBig', NATIVE_TYPE, '9000000'),
      coinObject('0xtoken1', TOKEN_TYPE, '100'),
      coinObject('0xtoken2', TOKEN_TYPE, '200'),
    ]
    const [input] = resolve(makePayload({ isNative: false, coins, amount: BigInt(250), gasBudget: BigInt(3_000_000) }))
    expect(new Set(input.pay!.inputCoins!.map(c => c!.objectId))).toEqual(new Set(['0xtoken1', '0xtoken2']))
    expect(input.pay!.gas!.objectId).toBe('0xgasCovers')
  })

  it('covering-selects token inputs when the amount needs every object', () => {
    const coins = [
      coinObject('0xgas', NATIVE_TYPE, '5000000'),
      coinObject('0xt1', TOKEN_TYPE, '100'),
      coinObject('0xt2', TOKEN_TYPE, '200'),
      coinObject('0xt3', TOKEN_TYPE, '300'),
    ]
    const [input] = resolve(makePayload({ isNative: false, coins, amount: BigInt(550), gasBudget: BigInt(3_000_000) }))
    expect(new Set(input.pay!.inputCoins!.map(c => c!.objectId))).toEqual(new Set(['0xt1', '0xt2', '0xt3']))
    expect(input.pay!.gas!.objectId).toBe('0xgas')
  })

  it('small token send references only the largest token object', () => {
    const coins = [
      coinObject('0xgas', NATIVE_TYPE, '5000000'),
      coinObject('0xt1', TOKEN_TYPE, '100'),
      coinObject('0xt2', TOKEN_TYPE, '200'),
      coinObject('0xt3', TOKEN_TYPE, '300'),
    ]
    const [input] = resolve(makePayload({ isNative: false, coins, amount: BigInt(250), gasBudget: BigInt(3_000_000) }))
    expect(input.pay!.inputCoins!.map(c => c!.objectId)).toEqual(['0xt3'])
    expect(input.pay!.gas!.objectId).toBe('0xgas')
  })

  it('throws when no native SUI object exists to pay gas', () => {
    const coins = [coinObject('0xt1', TOKEN_TYPE, '100')]
    expect(() =>
      resolve(makePayload({ isNative: false, coins, amount: BigInt(50), gasBudget: BigInt(3_000_000) }))
    ).toThrow(/at least one SUI coin for gas fees/)
  })
})
