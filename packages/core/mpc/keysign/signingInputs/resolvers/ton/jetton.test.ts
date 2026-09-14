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

const buildPayload = ({ toAmount = '1000', memo = '' } = {}) =>
  ({
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
    toAmount,
    memo,
  }) as unknown as KeysignPayload

const keysignPayload = buildPayload()

const walletCore = {
  TONAddressConverter: { toUserFriendly: () => receiverAddress },
} as unknown as WalletCore

const build = (jettonAddress: string) =>
  buildJettonTransfer({ keysignPayload, walletCore, jettonAddress, isActiveDestination: true, walletVersion: 'v4r2' })

const buildWithMemo = ({
  memo,
  toAmount = '5000000',
  isActiveDestination = true,
}: {
  memo: string
  toAmount?: string
  isActiveDestination?: boolean
}) =>
  buildJettonTransfer({
    keysignPayload: buildPayload({ toAmount, memo }),
    walletCore,
    jettonAddress: senderJettonWallet,
    isActiveDestination,
    walletVersion: 'v4r2',
  })

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

// A jetton comment rides inline in the transfer body's forward_payload rather
// than getting a cell of its own, so its budget is a fraction of a native
// transfer's 123 bytes and shrinks as the amount grows. The fixed 123-byte cap
// this replaced waved oversized memos through to WalletCore, which fails the
// whole keysign with a bare "Internal error" once the cell overflows.
describe('buildJettonTransfer — comment capacity', () => {
  it('accepts a comment that fills the inline budget exactly', () => {
    const transfer = buildWithMemo({ memo: 'x'.repeat(39) })

    expect(transfer.comment).toBe('x'.repeat(39))
  })

  it('rejects one byte more', () => {
    expect(() => buildWithMemo({ memo: 'x'.repeat(40) })).toThrow(/at most 39 bytes for this jetton amount/)
  })

  it('rejects a memo the old fixed 123-byte cap would have signed', () => {
    expect(() => buildWithMemo({ memo: 'x'.repeat(100) })).toThrow(/at most 39 bytes for this jetton amount/)
  })

  it('tightens the budget as the amount grows — the same memo fits one amount and not the next', () => {
    const memo = 'x'.repeat(39)

    expect(buildWithMemo({ memo, toAmount: '5000000' }).comment).toBe(memo)
    expect(() => buildWithMemo({ memo, toAmount: (10n ** 18n).toString() })).toThrow(/at most 34 bytes/)
  })

  it('gives an inactive destination one more byte, because the forward amount drops to zero', () => {
    expect(buildWithMemo({ memo: 'x'.repeat(40), isActiveDestination: false }).comment).toBe('x'.repeat(40))
  })
})
