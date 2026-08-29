import { Buffer } from 'buffer'

import { Chain } from '@vultisig/core-chain/Chain'
import { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { TW, WalletCore } from '@trustwallet/wallet-core'
import { describe, expect, it } from 'vitest'

import { buildJettonTransfer } from './jetton'
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
  const maxTonAmount = (1n << 120n) - 1n

  it('encodes non-negative native TON amounts as bytes', () => {
    // TON testnet transaction ee3d0d792404c489ee46fa335a951f7f9158a1758e6a24c3acfbc14b04441133
    // records a 1 TON internal-message value. Its 1_000_000_000 nanoton amount
    // must remain the unsigned big-endian bytes 3b9aca00 at this resolver boundary.
    // https://testnet.tonviewer.com/transaction/ee3d0d792404c489ee46fa335a951f7f9158a1758e6a24c3acfbc14b04441133
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

  it('accepts zero and the VarUInteger 16 maximum', () => {
    expect(tonAmountToBytes('0').toString('hex')).toBe('00')
    expect(tonAmountToBytes(maxTonAmount).toString('hex')).toBe('ff'.repeat(15))
  })

  it('rejects the first value above the VarUInteger 16 maximum', () => {
    expect(() => tonAmountToBytes(maxTonAmount + 1n)).toThrow('TON amount exceeds the VarUInteger 16 maximum')
  })

  it('rejects oversized decimal strings before bigint conversion', () => {
    expect(() => tonAmountToBytes('1'.repeat(10_000))).toThrow('TON amount exceeds the VarUInteger 16 maximum')
  })
})

describe('TON send mode', () => {
  const { ATTACH_ALL_CONTRACT_BALANCE, IGNORE_ACTION_PHASE_ERRORS, PAY_FEES_SEPARATELY } =
    TW.TheOpenNetwork.Proto.SendMode

  // A wallet contract signed with IGNORE_ACTION_PHASE_ERRORS skips an outgoing transfer it
  // cannot carry out instead of failing: the transaction lands un-aborted with the seqno
  // consumed and nothing moved, and no status check can tell that apart from a real send.
  // These modes are also part of the signing preimage, so a change here silently breaks
  // keysign against any co-signer still on the previous mode.
  const transfers = {
    'a native send': () =>
      buildNativeTonTransfer({ keysignPayload: buildPayload('1000000000'), bounceable: true, sendMaxAmount: false }),
    'a MAX native send': () =>
      buildNativeTonTransfer({ keysignPayload: buildPayload('0'), bounceable: true, sendMaxAmount: true }),
    'a dApp signTon message': () =>
      buildNativeTonTransferFromMessage({ to: TON_ADDRESS, amount: '1000000000', bounceable: true }),
    'a Jetton send': () =>
      buildJettonTransfer({
        keysignPayload: buildPayload('1000'),
        walletCore: {
          TONAddressConverter: { toUserFriendly: () => TON_ADDRESS },
        } as unknown as WalletCore,
        jettonAddress: TON_ADDRESS,
        isActiveDestination: true,
      }),
  }

  it.each(Object.entries(transfers))('never ignores action-phase errors on %s', (_, buildTransfer) => {
    expect(buildTransfer().mode & IGNORE_ACTION_PHASE_ERRORS).toBe(0)
  })

  it('pays fees separately on a fixed-amount send', () => {
    expect(transfers['a native send']().mode).toBe(PAY_FEES_SEPARATELY)
    expect(transfers['a dApp signTon message']().mode).toBe(PAY_FEES_SEPARATELY)
    expect(transfers['a Jetton send']().mode).toBe(PAY_FEES_SEPARATELY)
  })

  it('sweeps the contract balance on a MAX send', () => {
    expect(transfers['a MAX native send']().mode).toBe(ATTACH_ALL_CONTRACT_BALANCE)
  })
})
