import { Buffer } from 'buffer'

import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { TonSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'
import { initWasm, TW, WalletCore } from '@trustwallet/wallet-core'
import { beforeAll, describe, expect, it } from 'vitest'

import { getTonSigningInputs } from './index'

const senderAddress = 'UQCc9iCgP_b5RMJcFE5XD8zStfjtNHLhDWfUqC5m1SjSer95'
const receiverAddress = 'UQDmLe6ticcY_uLZsfurdYONshNuCn8IS81KcJ8p6M6ISMcB'

// The number a MAX button shows: balance minus the reserved fee, not the balance.
const displayedMaxAmount = '9_950_000_000'.replaceAll('_', '')

const buildPayload = ({ toAmount, sendMaxAmount }: { toAmount: string; sendMaxAmount: boolean }): KeysignPayload =>
  ({
    coin: {
      chain: Chain.Ton,
      ticker: 'TON',
      address: senderAddress,
      decimals: 9,
      isNativeToken: true,
      hexPublicKey: '6c756400bac0b153b421df6e199302537d12f7d4a53447004485700a958e7571',
    },
    toAddress: receiverAddress,
    toAmount,
    memo: '',
    blockchainSpecific: {
      case: 'tonSpecific',
      value: create(TonSpecificSchema, {
        sequenceNumber: 4n,
        expireAt: 1753579977n,
        bounceable: false,
        sendMaxAmount,
        jettonAddress: '',
        isActiveDestination: false,
      }),
    },
  }) as unknown as KeysignPayload

let walletCore: WalletCore

beforeAll(async () => {
  walletCore = await initWasm()
})

// The resolver is synchronous for TON, but its shared signature allows a promise.
const buildSigningInput = async (keysignPayload: KeysignPayload) => {
  const [input] = await getTonSigningInputs({ keysignPayload, walletCore })

  return input
}

const encode = async (keysignPayload: KeysignPayload) =>
  Buffer.from(TW.TheOpenNetwork.Proto.SigningInput.encode(await buildSigningInput(keysignPayload)).finish()).toString(
    'hex'
  )

describe('getTonSigningInputs — a MAX send signs the displayed amount', () => {
  const maxPayload = buildPayload({ toAmount: displayedMaxAmount, sendMaxAmount: true })

  it('signs the amount from the payload, not a zero-amount balance sweep', async () => {
    const [message] = (await buildSigningInput(maxPayload)).messages
    const amount = Buffer.from(shouldBePresent(message.amount, 'TON transfer amount')).toString('hex')

    expect(BigInt(`0x${amount}`)).toBe(BigInt(displayedMaxAmount))
    expect(
      shouldBePresent(message.mode, 'TON send mode') & TW.TheOpenNetwork.Proto.SendMode.ATTACH_ALL_CONTRACT_BALANCE
    ).toBe(0)
  })

  // The bug this pins: `sendMaxAmount` used to swap the amount for 0 and the send mode
  // for a full-balance sweep, so the transaction did something other than what the
  // screen showed. It is descriptive metadata now — the bytes must not depend on it.
  it('signs byte-identical input whether or not the send is flagged MAX', async () => {
    const explicitPayload = buildPayload({ toAmount: displayedMaxAmount, sendMaxAmount: false })

    expect(await encode(maxPayload)).toBe(await encode(explicitPayload))
  })

  it('still distinguishes two different amounts', async () => {
    const other = buildPayload({ toAmount: '1000000000', sendMaxAmount: true })

    expect(await encode(maxPayload)).not.toBe(await encode(other))
  })
})

// The same key, its W5 account. The payload carries no wallet-version field:
// the sender address is what says which contract is being driven.
const w5SenderAddress = 'UQCiCOKISC3h1l7re_h5NLjH5gLcE4FkJMDMBSnI4FFWtP44'

const withSender = (keysignPayload: KeysignPayload, address: string): KeysignPayload =>
  ({ ...keysignPayload, coin: { ...keysignPayload.coin, address } }) as unknown as KeysignPayload

const withDappMessages = (keysignPayload: KeysignPayload, count: number): KeysignPayload =>
  ({
    ...keysignPayload,
    signData: {
      case: 'signTon',
      value: {
        tonMessages: Array.from({ length: count }, () => ({
          to: receiverAddress,
          amount: '1',
          payload: '',
          stateInit: '',
        })),
      },
    },
  }) as unknown as KeysignPayload

describe('getTonSigningInputs — wallet contract follows the sender address', () => {
  const payload = buildPayload({ toAmount: '1000000000', sendMaxAmount: false })
  const { IGNORE_ACTION_PHASE_ERRORS } = TW.TheOpenNetwork.Proto.SendMode
  const { WALLET_V4_R2, WALLET_V5_R1 } = TW.TheOpenNetwork.Proto.WalletVersion

  it('signs a V4R2 request for the V4R2 address, without ignoring action-phase errors', async () => {
    const input = await buildSigningInput(payload)

    expect(input.walletVersion).toBe(WALLET_V4_R2)
    expect(shouldBePresent(input.messages[0].mode, 'mode') & IGNORE_ACTION_PHASE_ERRORS).toBe(0)
  })

  // W5's code rejects an external request whose actions do not carry the
  // ignore-errors flag — a guaranteed seqno advance is its replay protection —
  // so that flag is part of driving the contract at all.
  it('signs a W5 request for the W5 address, with the flag the contract demands', async () => {
    const input = await buildSigningInput(withSender(payload, w5SenderAddress))

    expect(input.walletVersion).toBe(WALLET_V5_R1)
    expect(shouldBePresent(input.messages[0].mode, 'mode') & IGNORE_ACTION_PHASE_ERRORS).toBe(
      IGNORE_ACTION_PHASE_ERRORS
    )
  })

  it("refuses to sign for an address that is not this key's wallet under any contract", async () => {
    await expect(buildSigningInput(withSender(payload, receiverAddress))).rejects.toThrow(
      /refusing to sign for an unknown wallet contract/
    )
  })

  it('caps a request at what the contract can carry: four messages on V4, 255 on W5', async () => {
    await expect(buildSigningInput(withDappMessages(payload, 5))).rejects.toThrow(/at most 4 messages/)

    const w5 = await buildSigningInput(withDappMessages(withSender(payload, w5SenderAddress), 5))
    expect(w5.messages).toHaveLength(5)
    expect(w5.walletVersion).toBe(WALLET_V5_R1)
  })
})
