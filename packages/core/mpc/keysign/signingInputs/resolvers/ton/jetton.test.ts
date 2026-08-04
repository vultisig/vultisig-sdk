import { Buffer } from 'buffer'
import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { CoinSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/coin_pb'
import { KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { describe, expect, it } from 'vitest'

import { buildJettonTransfer } from './jetton'

const keysignPayload = create(KeysignPayloadSchema, {
  coin: create(CoinSchema, {
    chain: Chain.Ton,
    ticker: 'USDT',
    address: 'UQAqbua3_0G_7K_jgzhjJceolfT-TONGsY65wUoBUtZinP1w',
    decimals: 6,
    contractAddress: 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs',
    isNativeToken: false,
  }),
  toAddress: 'UQCXhTIYi7zucgALWCxYRAHjwJbLDyZVUZVOa-FzD7UA5P5O',
  toAmount: '1000000',
})

const walletCore = {
  TONAddressConverter: { toUserFriendly: (address: string) => address },
} as never

const bytesToBigInt = (value: Uint8Array): bigint => BigInt(`0x${Buffer.from(value).toString('hex')}`)

describe('buildJettonTransfer', () => {
  it('keeps the 0.08 TON attachment for an active destination', () => {
    const transfer = buildJettonTransfer({
      keysignPayload,
      walletCore,
      jettonAddress: 'EQAtiFQ15MZBgpAGwD1jfJm6maz5otBOPefyw9Wc3MVmMgzp',
      isActiveDestination: true,
    })

    expect(bytesToBigInt(transfer.amount!)).toBe(80_000_000n)
    expect(bytesToBigInt(transfer.jettonTransfer!.forwardAmount!)).toBe(1n)
  })

  it('raises the attachment to 0.1 TON for a first-time recipient', () => {
    const transfer = buildJettonTransfer({
      keysignPayload,
      walletCore,
      jettonAddress: 'EQAtiFQ15MZBgpAGwD1jfJm6maz5otBOPefyw9Wc3MVmMgzp',
      isActiveDestination: false,
    })

    expect(bytesToBigInt(transfer.amount!)).toBe(100_000_000n)
    expect(bytesToBigInt(transfer.jettonTransfer!.forwardAmount!)).toBe(0n)
  })
})
