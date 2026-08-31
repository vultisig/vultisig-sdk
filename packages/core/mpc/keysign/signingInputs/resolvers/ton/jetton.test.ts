import { Buffer } from 'buffer'

import { Chain } from '@vultisig/core-chain/Chain'
import { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'
import { WalletCore } from '@trustwallet/wallet-core'
import { describe, expect, it } from 'vitest'

import { buildJettonTransfer } from './jetton'

const ownerAddress = 'UQCc9iCgP_b5RMJcFE5XD8zStfjtNHLhDWfUqC5m1SjSer95'
const receiverAddress = 'UQDmLe6ticcY_uLZsfurdYONshNuCn8IS81KcJ8p6M6ISMcB'
const senderJettonWallet = 'EQCIcjES4cQET0z6nRixZ0MdvTB4u3_8triztLSrIIrDkpgJ'

const keysignPayload = {
  coin: {
    chain: Chain.Ton,
    ticker: 'USDT',
    address: ownerAddress,
    decimals: 6,
    isNativeToken: false,
    contractAddress: 'EQjettonMaster',
    hexPublicKey: '11'.repeat(32),
  },
  toAddress: receiverAddress,
  toAmount: '1000',
  memo: '',
} as unknown as KeysignPayload

const walletCore = {
  TONAddressConverter: { toUserFriendly: () => receiverAddress },
} as unknown as WalletCore

const build = (jettonAddress: string) =>
  buildJettonTransfer({ keysignPayload, walletCore, jettonAddress, isActiveDestination: true })

describe('buildJettonTransfer', () => {
  it('sends to the resolved sender jetton wallet', () => {
    const transfer = build(senderJettonWallet)

    expect(transfer.dest).toBe(senderJettonWallet)
    const jettonTransfer = shouldBePresent(transfer.jettonTransfer, 'jetton transfer')
    const jettonAmount = shouldBePresent(jettonTransfer.jettonAmount, 'jetton amount')
    expect(Buffer.from(jettonAmount).toString('hex')).toBe('03e8')
  })

  // `TonSpecific.jettonAddress` is a plain proto string, so an unresolved lookup
  // arrives here as '' rather than as null — which is why the presence check this
  // replaced let it through and produced a transfer to no destination.
  it.each([
    ['an empty address', ''],
    ['a blank address', '   '],
  ])('refuses to build a transfer with %s', (_, jettonAddress) => {
    expect(() => build(jettonAddress)).toThrow(/sender jetton wallet address is missing/)
  })
})
