import { Buffer } from 'buffer'

import { Chain } from '@vultisig/core-chain/Chain'
import { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { describe, expect, it } from 'vitest'

import { buildNativeTonTransfer, buildNativeTonTransferFromMessage, tonAmountToBytes } from './native'

const TON_ADDRESS = 'EQAtiFQ15MZBgpAGwD1jfJm6maz5otBOPefyw9Wc3MVmMgzp'

const buildPayload = (toAmount: string): KeysignPayload =>
  ({
    coin: {
      chain: Chain.Ton,
      ticker: 'GRAM',
      address: TON_ADDRESS,
      decimals: 9,
      isNativeToken: true,
      hexPublicKey: '11'.repeat(32),
    },
    toAddress: TON_ADDRESS,
    toAmount,
    memo: '',
  }) as KeysignPayload

describe('TON signing input amount encoding', () => {
  it('encodes non-negative native TON amounts as bytes', () => {
    const transfer = buildNativeTonTransfer({
      keysignPayload: buildPayload('1000000000'),
      bounceable: true,
      sendMaxAmount: false,
    })

    expect(Buffer.from(transfer.amount).toString('hex')).toBe('3b9aca00')
  })

  it('rejects negative native TON amounts before hex encoding', () => {
    expect(() =>
      buildNativeTonTransfer({
        keysignPayload: buildPayload('-1'),
        bounceable: true,
        sendMaxAmount: false,
      })
    ).toThrow('TON amount must be a non-negative integer')
  })

  it('rejects negative dApp signTon message amounts before hex encoding', () => {
    expect(() =>
      buildNativeTonTransferFromMessage({
        to: TON_ADDRESS,
        amount: '-1',
        bounceable: true,
      })
    ).toThrow('TON amount must be a non-negative integer')
  })

  it('rejects negative bigint amounts used by Jetton amount helpers', () => {
    expect(() => tonAmountToBytes(-1n)).toThrow('TON amount must be a non-negative integer')
  })
})
