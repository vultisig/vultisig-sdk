import { Buffer } from 'buffer'

import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { TonSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'
import { TW, WalletCore } from '@trustwallet/wallet-core'
import { describe, expect, it } from 'vitest'

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

// The resolver is synchronous for TON, but its shared signature allows a promise.
const buildSigningInput = async (keysignPayload: KeysignPayload) => {
  const [input] = await getTonSigningInputs({ keysignPayload, walletCore: {} as unknown as WalletCore })

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
