import { create, type MessageInitShape } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { OneInchSwapPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/1inch_swap_payload_pb'
import { THORChainSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { Coin, CoinSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/coin_pb'
import { KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { THORChainSwapPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/thorchain_swap_payload_pb'
import { describe, expect, it } from 'vitest'

import { getFeeAmount } from '../fee'
import { getEncodedSigningInputs } from '../signingInputs'
import { assertKeysignSwapSellsSigningCoin } from './assertKeysignSwapSellsSigningCoin'

type Overrides = Omit<MessageInitShape<typeof KeysignPayloadSchema>, '$typeName' | 'coin' | 'swapPayload'>

const makeCoin = (chain: Chain, ticker: string, decimals: number) =>
  create(CoinSchema, {
    chain,
    ticker,
    decimals,
    address: 'addr',
    isNativeToken: true,
    contractAddress: '',
  })

const eth = makeCoin(Chain.Ethereum, 'ETH', 18)
const btc = makeCoin(Chain.Bitcoin, 'BTC', 8)
const rune = makeCoin(Chain.THORChain, 'RUNE', 8)

const oneInch = (coin: Coin, fromCoin?: Coin) =>
  create(KeysignPayloadSchema, {
    coin,
    swapPayload: {
      case: 'oneinchSwapPayload',
      value: create(OneInchSwapPayloadSchema, { provider: '1inch', fromCoin }),
    },
  })

const thorchain = (coin: Coin, fromCoin: Coin, overrides: Overrides = {}) =>
  create(KeysignPayloadSchema, {
    coin,
    swapPayload: {
      case: 'thorchainSwapPayload',
      value: create(THORChainSwapPayloadSchema, {
        fromCoin,
        fromAmount: '100',
        routerAddress: '',
      }),
    },
    ...overrides,
  })

describe('assertKeysignSwapSellsSigningCoin', () => {
  it('ignores payloads without a swap', () => {
    expect(() => assertKeysignSwapSellsSigningCoin(create(KeysignPayloadSchema, { coin: eth }))).not.toThrow()
  })

  it('accepts a general swap selling the signing coin', () => {
    expect(() => assertKeysignSwapSellsSigningCoin(oneInch(eth, eth))).not.toThrow()
  })

  it('refuses a general swap selling another coin than the one signed', () => {
    expect(() => assertKeysignSwapSellsSigningCoin(oneInch(btc, eth))).toThrow(/chain differs/)
  })

  it('refuses a general swap with no source coin', () => {
    expect(() => assertKeysignSwapSellsSigningCoin(oneInch(eth))).toThrow(/no source coin/)
  })

  it('accepts a native swap selling the signing coin', () => {
    expect(() => assertKeysignSwapSellsSigningCoin(thorchain(btc, btc))).not.toThrow()
  })

  it('refuses a native swap selling another coin than the one signed', () => {
    expect(() => assertKeysignSwapSellsSigningCoin(thorchain(rune, btc))).toThrow(/chain differs/)
  })

  it('refuses a native swap whose decimals differ from the signing coin', () => {
    const wrongDecimals = makeCoin(Chain.Bitcoin, 'BTC', 18)
    expect(() => assertKeysignSwapSellsSigningCoin(thorchain(btc, wrongDecimals))).toThrow(/decimals differ/)
  })

  describe('secured-asset withdrawal', () => {
    const withdrawal = (overrides: Overrides = {}) =>
      thorchain(rune, btc, {
        toAddress: '',
        toAmount: '100',
        memo: 'SECURE-:bc1qdest',
        blockchainSpecific: {
          case: 'thorchainSpecific',
          value: create(THORChainSpecificSchema, { isDeposit: true }),
        },
        ...overrides,
      })

    it('is exempt', () => {
      expect(() => assertKeysignSwapSellsSigningCoin(withdrawal())).not.toThrow()
    })

    it('is not exempt when the shape deviates (non-empty toAddress)', () => {
      expect(() => assertKeysignSwapSellsSigningCoin(withdrawal({ toAddress: 'thor1abc' }))).toThrow(/chain differs/)
    })
  })
})

describe('wiring', () => {
  const mismatched = oneInch(btc, eth)

  it('getEncodedSigningInputs refuses before building', async () => {
    await expect(
      getEncodedSigningInputs({
        keysignPayload: mismatched,
        walletCore: undefined,
        publicKey: undefined,
      } as never)
    ).rejects.toThrow(/refusing to sign/)
  })

  it('getFeeAmount refuses before resolving', async () => {
    await expect(
      getFeeAmount({
        keysignPayload: mismatched,
        walletCore: undefined,
        publicKey: undefined,
      } as never)
    ).rejects.toThrow(/refusing to sign/)
  })
})
