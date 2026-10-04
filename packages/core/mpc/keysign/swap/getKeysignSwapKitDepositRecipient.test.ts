import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import {
  OneInchQuoteSchema,
  OneInchSwapPayloadSchema,
  OneInchTransactionSchema,
} from '@vultisig/core-mpc/types/vultisig/keysign/v1/1inch_swap_payload_pb'
import { CoinSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/coin_pb'
import { KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { describe, expect, it } from 'vitest'

import { getKeysignSwapKitDepositRecipient } from './getKeysignSwapKitDepositRecipient'

const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const DEPOSIT = '0x1f01af4e50082e2982ba5041707efddd3aa4c121'
const ROUTER = '0x2222222222222222222222222222222222222222'
const AMOUNT = 20_000_000n

const word = (hex: string) => hex.replace(/^0x/, '').toLowerCase().padStart(64, '0')

const buildSwapKitPayload = ({ to, data }: { to: string; data: string }) => {
  const coin = create(CoinSchema, { chain: Chain.Ethereum, ticker: 'USDC', contractAddress: USDC })
  return create(KeysignPayloadSchema, {
    coin,
    swapPayload: {
      case: 'oneinchSwapPayload',
      value: create(OneInchSwapPayloadSchema, {
        provider: 'swapkit',
        fromCoin: coin,
        fromAmount: AMOUNT.toString(),
        quote: create(OneInchQuoteSchema, { tx: create(OneInchTransactionSchema, { to, data, value: '0' }) }),
      }),
    },
  })
}

describe('getKeysignSwapKitDepositRecipient', () => {
  it('returns the recipient a SwapKit deposit transfers the sold amount to', () => {
    const data = `0xa9059cbb${word(DEPOSIT)}${word(AMOUNT.toString(16))}`

    expect(getKeysignSwapKitDepositRecipient(buildSwapKitPayload({ to: USDC, data }))).toBe(DEPOSIT)
  })

  it('returns undefined for a SwapKit router swap', () => {
    expect(getKeysignSwapKitDepositRecipient(buildSwapKitPayload({ to: ROUTER, data: '0xabcdef' }))).toBeUndefined()
  })
})
