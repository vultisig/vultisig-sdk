import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { TonSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { WalletCore } from '@trustwallet/wallet-core'
import { describe, expect, it } from 'vitest'

import { getTonSigningInputs } from './index'

const senderAddress = 'UQCc9iCgP_b5RMJcFE5XD8zStfjtNHLhDWfUqC5m1SjSer95'

// One destination of each shape a dApp can hand over: a non-bounceable wallet, a
// bounceable contract, and a bounceable masterchain address.
const nonBounceableDestination = 'UQDmLe6ticcY_uLZsfurdYONshNuCn8IS81KcJ8p6M6ISMcB'
const bounceableDestination = 'EQCIcjES4cQET0z6nRixZ0MdvTB4u3_8triztLSrIIrDkpgJ'
const masterchainDestination = 'Ef8t6cZkqFuHjJ_a_ydEK_tu3LHWRA4JZXRyewLY4j8FZ6B5'

type BuildPayloadInput = {
  bounceable: boolean
  memo?: string
  tonMessages?: Array<{ to: string; amount: string; stateInit?: string }>
}

const buildPayload = ({ bounceable, memo = '', tonMessages }: BuildPayloadInput): KeysignPayload =>
  ({
    coin: {
      chain: Chain.Ton,
      ticker: 'GRAM',
      address: senderAddress,
      decimals: 9,
      isNativeToken: true,
      hexPublicKey: '6c756400bac0b153b421df6e199302537d12f7d4a53447004485700a958e7571',
    },
    toAddress: tonMessages?.[0]?.to ?? nonBounceableDestination,
    toAmount: tonMessages ? '0' : '1000000',
    memo,
    blockchainSpecific: {
      case: 'tonSpecific',
      value: create(TonSpecificSchema, {
        sequenceNumber: 0n,
        expireAt: 1753579977n,
        bounceable,
        sendMaxAmount: false,
        jettonAddress: '',
        isActiveDestination: false,
      }),
    },
    signData: tonMessages ? { case: 'signTon', value: { tonMessages } } : { case: undefined },
  }) as unknown as KeysignPayload

// The resolver is synchronous for TON, but its shared signature allows a promise.
const buildMessages = async (keysignPayload: KeysignPayload) => {
  const [input] = await getTonSigningInputs({
    keysignPayload,
    walletCore: {} as unknown as WalletCore,
  })

  return input.messages.map(message => ({
    dest: message.dest,
    bounceable: message.bounceable,
  }))
}

const dappMessages = [nonBounceableDestination, bounceableDestination, masterchainDestination].map(to => ({
  to,
  amount: '1000000',
}))

describe('getTonSigningInputs — dApp messages carry their own bounce flag', () => {
  it('derives each message flag from its destination address, not from the wallet-level flag', async () => {
    const messages = await buildMessages(buildPayload({ bounceable: false, tonMessages: dappMessages }))

    expect(messages).toEqual([
      { dest: nonBounceableDestination, bounceable: false },
      { dest: bounceableDestination, bounceable: true },
      { dest: masterchainDestination, bounceable: true },
    ])
  })

  it('ignores a wallet-level flag that disagrees with a destination', async () => {
    const messages = await buildMessages(buildPayload({ bounceable: true, tonMessages: dappMessages }))

    expect(messages.map(({ bounceable }) => bounceable)).toEqual([false, true, true])
  })

  it('does not let the nominator-pool comment override reach dApp messages', async () => {
    const messages = await buildMessages(
      buildPayload({
        bounceable: false,
        memo: 'Deposit',
        tonMessages: dappMessages.slice(0, 1),
      })
    )

    expect(messages).toEqual([{ dest: nonBounceableDestination, bounceable: false }])
  })

  it('treats a raw destination without stateInit as bounceable', async () => {
    const rawDestination = '0:e62deead89c718fee2d9b1fbab75838db2136e0a7f084bcd4a709f29e8ce8848'
    const messages = await buildMessages(
      buildPayload({
        bounceable: true,
        tonMessages: [{ to: rawDestination, amount: '1000000' }],
      })
    )

    expect(messages).toEqual([{ dest: rawDestination, bounceable: true }])
  })

  it('treats a raw deployment destination with stateInit as non-bounceable', async () => {
    const rawDestination = '0:e62deead89c718fee2d9b1fbab75838db2136e0a7f084bcd4a709f29e8ce8848'
    const messages = await buildMessages(
      buildPayload({
        bounceable: true,
        tonMessages: [{ to: rawDestination, amount: '1000000', stateInit: 'te6ccgEBAQEAAwAAAgE=' }],
      })
    )

    expect(messages).toEqual([{ dest: rawDestination, bounceable: false }])
  })
})

describe('getTonSigningInputs — app-initiated sends keep the wallet-level flag', () => {
  it('signs a plain send with the flag the chain-specific resolver decided', async () => {
    expect(await buildMessages(buildPayload({ bounceable: true }))).toEqual([
      { dest: nonBounceableDestination, bounceable: true },
    ])
    expect(await buildMessages(buildPayload({ bounceable: false }))).toEqual([
      { dest: nonBounceableDestination, bounceable: false },
    ])
  })

  it('still forces a nominator-pool deposit bounceable', async () => {
    expect(await buildMessages(buildPayload({ bounceable: false, memo: 'Deposit' }))).toEqual([
      { dest: nonBounceableDestination, bounceable: true },
    ])
  })
})
