import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import {
  OneInchQuoteSchema,
  OneInchSwapPayloadSchema,
  OneInchTransactionSchema,
} from '@vultisig/core-mpc/types/vultisig/keysign/v1/1inch_swap_payload_pb'
import { CoinSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/coin_pb'
import { KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { SwapKitSwapPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/swapkit_swap_payload_pb'
import { describe, expect, it } from 'vitest'

import { assertKeysignSwapKitAmounts } from './assertKeysignSwapKitAmounts'

const MAX_UINT256 = (1n << 256n) - 1n

const evmPayload = ({ provider = 'swapkit', fromAmount = '1000', value = '0' } = {}) => {
  const coin = create(CoinSchema, { chain: Chain.Ethereum, ticker: 'ETH', isNativeToken: true })
  return create(KeysignPayloadSchema, {
    coin,
    swapPayload: {
      case: 'oneinchSwapPayload',
      value: create(OneInchSwapPayloadSchema, {
        provider,
        fromCoin: coin,
        fromAmount,
        quote: create(OneInchQuoteSchema, { tx: create(OneInchTransactionSchema, { to: '0x1', data: '0x', value }) }),
      }),
    },
  })
}

const bitcoinPayload = (fromAmount: string) => {
  const coin = create(CoinSchema, { chain: Chain.Bitcoin, ticker: 'BTC', isNativeToken: true })
  return create(KeysignPayloadSchema, {
    coin,
    swapPayload: {
      case: 'swapkitSwapPayload',
      value: create(SwapKitSwapPayloadSchema, { fromCoin: coin, fromAmount }),
    },
  })
}

describe('assertKeysignSwapKitAmounts', () => {
  it('accepts plain decimal amounts up to uint256', () => {
    expect(() => assertKeysignSwapKitAmounts(evmPayload({ value: MAX_UINT256.toString() }))).not.toThrow()
    expect(() => assertKeysignSwapKitAmounts(bitcoinPayload('1000'))).not.toThrow()
  })

  it.each([['0x10'], ['+100'], [' 100'], ['1e3'], ['']])('refuses an EVM tx.value %j', value => {
    expect(() => assertKeysignSwapKitAmounts(evmPayload({ value }))).toThrow()
  })

  it.each([['+100'], ['0x10'], ['-1'], ['']])('refuses a fromAmount %j on every chain', fromAmount => {
    expect(() => assertKeysignSwapKitAmounts(evmPayload({ fromAmount }))).toThrow()
    expect(() => assertKeysignSwapKitAmounts(bitcoinPayload(fromAmount))).toThrow()
  })

  it('refuses an amount above uint256', () => {
    expect(() => assertKeysignSwapKitAmounts(evmPayload({ value: (MAX_UINT256 + 1n).toString() }))).toThrow(/uint256/)
    expect(() => assertKeysignSwapKitAmounts(bitcoinPayload((MAX_UINT256 + 1n).toString()))).toThrow(/uint256/)
  })

  it('leaves other providers to their own guards', () => {
    expect(() => assertKeysignSwapKitAmounts(evmPayload({ provider: '1inch', value: '0x10' }))).not.toThrow()
  })
})
