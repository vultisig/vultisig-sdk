import { Buffer } from 'buffer'

import { Chain } from '@vultisig/core-chain/Chain'
import { tonConfig } from '@vultisig/core-chain/chains/ton/config'
import { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { numberToEvenHex } from '@vultisig/lib-utils/hex/numberToHex'
import { WalletCore } from '@trustwallet/wallet-core'
import { describe, expect, it, vi } from 'vitest'

import { buildJettonTransfer } from './jetton'

const TON_ADDRESS = 'EQAtiFQ15MZBgpAGwD1jfJm6maz5otBOPefyw9Wc3MVmMgzp'
const JETTON_WALLET_ADDRESS = 'EQD__________________________________________0vo'

const buildPayload = (toAmount: string): KeysignPayload =>
  ({
    coin: {
      chain: Chain.Ton,
      ticker: 'GRAM',
      address: TON_ADDRESS,
      decimals: 9,
      isNativeToken: false,
      hexPublicKey: '11'.repeat(32),
    },
    toAddress: TON_ADDRESS,
    toAmount,
    memo: '',
  }) as KeysignPayload

const walletCore = {
  TONAddressConverter: {
    toUserFriendly: vi.fn(() => TON_ADDRESS),
  },
} as unknown as WalletCore

describe('buildJettonTransfer gas floor', () => {
  it('uses the flat gas floor for an already-active destination', () => {
    const transfer = buildJettonTransfer({
      keysignPayload: buildPayload('1000000000'),
      walletCore,
      jettonAddress: JETTON_WALLET_ADDRESS,
      isActiveDestination: true,
    })

    expect(Buffer.from(transfer.amount).toString('hex')).toBe(numberToEvenHex(tonConfig.jettonAmount))
    expect(Buffer.from(transfer.jettonTransfer!.forwardAmount).toString('hex')).toBe('01')
  })

  it('raises the gas floor for a not-yet-active destination (new jetton wallet deploy)', () => {
    // sdk#1465: a flat 0.08 TON under-funds the jetton-wallet deployment a
    // first-time recipient needs, so TON bounces/rejects the send.
    const transfer = buildJettonTransfer({
      keysignPayload: buildPayload('1000000000'),
      walletCore,
      jettonAddress: JETTON_WALLET_ADDRESS,
      isActiveDestination: false,
    })

    expect(Buffer.from(transfer.amount).toString('hex')).toBe(numberToEvenHex(tonConfig.jettonAmountNewWallet))
    expect(tonConfig.jettonAmountNewWallet).toBeGreaterThan(tonConfig.jettonAmount)
    expect(Buffer.from(transfer.jettonTransfer!.forwardAmount).toString('hex')).toBe('00')
  })
})
