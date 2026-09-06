import { Buffer } from 'buffer'

import { Chain } from '@vultisig/core-chain/Chain'
import { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { TW, WalletCore } from '@trustwallet/wallet-core'
import { describe, expect, it } from 'vitest'

import { buildJettonTransfer } from './jetton'
import { buildNativeTonTransfer, buildNativeTonTransferFromMessage, getTonSendMode, tonAmountToBytes } from './native'

const TON_ADDRESS = 'EQAtiFQ15MZBgpAGwD1jfJm6maz5otBOPefyw9Wc3MVmMgzp'

const buildPayload = (toAmount: string, memo = ''): KeysignPayload =>
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
    memo,
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
      walletVersion: 'v4r2',
    })

    expect(Buffer.from(transfer.amount).toString('hex')).toBe('3b9aca00')
  })

  it('rejects negative native TON amounts before hex encoding', () => {
    expect(() =>
      buildNativeTonTransfer({
        keysignPayload: buildPayload('-1'),
        bounceable: true,
        walletVersion: 'v4r2',
      })
    ).toThrow('TON amount must be a non-negative integer')
  })

  it('rejects negative dApp signTon message amounts before hex encoding', () => {
    expect(() =>
      buildNativeTonTransferFromMessage({
        to: TON_ADDRESS,
        amount: '-1',
        bounceable: true,
        walletVersion: 'v4r2',
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
      buildNativeTonTransfer({ keysignPayload: buildPayload('1000000000'), bounceable: true, walletVersion: 'v4r2' }),
    'a dApp signTon message': () =>
      buildNativeTonTransferFromMessage({
        to: TON_ADDRESS,
        amount: '1000000000',
        bounceable: true,
        walletVersion: 'v4r2',
      }),
    'a Jetton send': () =>
      buildJettonTransfer({
        walletVersion: 'v4r2',
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

  it.each(Object.entries(transfers))('pays fees separately on %s', (_, buildTransfer) => {
    expect(buildTransfer().mode).toBe(PAY_FEES_SEPARATELY)
  })

  // A MAX send is an ordinary `balance - fee` amount, so nothing sweeps the contract
  // balance at execution time. See the "TON MAX send" block below.
  it.each(Object.entries(transfers))('never sweeps the contract balance on %s', (_, buildTransfer) => {
    expect(buildTransfer().mode & ATTACH_ALL_CONTRACT_BALANCE).toBe(0)
  })
})

describe('TON MAX send', () => {
  const { ATTACH_ALL_CONTRACT_BALANCE, PAY_FEES_SEPARATELY } = TW.TheOpenNetwork.Proto.SendMode

  // `ATTACH_ALL_CONTRACT_BALANCE` hands the contract a sweep it resolves when the
  // transaction executes, so the amount that moves is whatever the balance is then —
  // not the number the user approved. A MAX send has to be an ordinary amount.
  const maxSendAmount = '9990000000'

  it('signs the amount it was given rather than a zero-amount sweep', () => {
    const transfer = buildNativeTonTransfer({
      keysignPayload: buildPayload(maxSendAmount),
      bounceable: true,
      walletVersion: 'v4r2',
    })

    expect(tonAmountToBytes(maxSendAmount).equals(Buffer.from(transfer.amount))).toBe(true)
    // Asserted as bits rather than an exact mode so this keeps holding as other flags
    // in the same field come and go.
    expect(transfer.mode & PAY_FEES_SEPARATELY).toBe(PAY_FEES_SEPARATELY)
    expect(transfer.mode & ATTACH_ALL_CONTRACT_BALANCE).toBe(0)
  })

  it('never signs a zero amount for a non-zero send', () => {
    const transfer = buildNativeTonTransfer({
      keysignPayload: buildPayload(maxSendAmount),
      bounceable: true,
      walletVersion: 'v4r2',
    })

    expect(Buffer.from(transfer.amount).toString('hex')).not.toBe('00')
  })
})

describe('TON send mode on a W5 wallet', () => {
  const { IGNORE_ACTION_PHASE_ERRORS, PAY_FEES_SEPARATELY } = TW.TheOpenNetwork.Proto.SendMode

  // W5's code refuses an external request unless every action ignores action-phase
  // errors — a guaranteed seqno advance is its replay protection — so on W5 the
  // flag is not a choice. The status resolver's action-phase check is what keeps a
  // skipped transfer from being reported as a success.
  it.each([
    [
      'a native send',
      () =>
        buildNativeTonTransfer({ keysignPayload: buildPayload('1000000000'), bounceable: true, walletVersion: 'v5r1' }),
    ],
    [
      'a dApp signTon message',
      () =>
        buildNativeTonTransferFromMessage({
          to: TON_ADDRESS,
          amount: '1000000000',
          bounceable: true,
          walletVersion: 'v5r1',
        }),
    ],
  ])('sets the ignore-errors flag the contract requires on %s', (_, build) => {
    const { mode } = build()

    expect(mode & PAY_FEES_SEPARATELY).toBe(PAY_FEES_SEPARATELY)
    expect(mode & IGNORE_ACTION_PHASE_ERRORS).toBe(IGNORE_ACTION_PHASE_ERRORS)
  })

  it('reports each contract mode from one place', () => {
    expect(getTonSendMode('v4r2') & IGNORE_ACTION_PHASE_ERRORS).toBe(0)
    expect(getTonSendMode('v5r1')).toBe(getTonSendMode('v4r2') | IGNORE_ACTION_PHASE_ERRORS)
  })
})

// A native comment is the message body's own cell, so it gets the whole 1023
// bits minus the 32-bit opcode — unlike a jetton comment, which shares its cell
// with the transfer fields and gets a fraction of that.
describe('TON native comment capacity', () => {
  const build = (memo: string) =>
    buildNativeTonTransfer({
      keysignPayload: buildPayload('1000000000', memo),
      bounceable: true,
      walletVersion: 'v4r2',
    })

  it('carries a comment that fills the cell exactly', () => {
    expect(build('x'.repeat(123)).comment).toBe('x'.repeat(123))
  })

  it('rejects one byte more', () => {
    expect(() => build('x'.repeat(124))).toThrow(/at most 123 bytes \(got 124\)/)
  })

  it('counts UTF-8 bytes rather than characters', () => {
    expect(() => build('→'.repeat(42))).toThrow(/got 126/)
  })
})
