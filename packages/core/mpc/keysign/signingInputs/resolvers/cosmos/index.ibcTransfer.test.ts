import { Buffer } from 'buffer'

import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { initWasm, type WalletCore } from '@trustwallet/wallet-core'
import {
  CosmosIbcDenomTraceSchema,
  CosmosSpecificSchema,
  TransactionType,
} from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { CoinSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/coin_pb'
import { KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { beforeAll, describe, expect, it } from 'vitest'

import { getCosmosSigningInputs } from './index'

// COSMOS-01 / COSMOS-03: an ibc-enabled Cosmos chain's IBC_TRANSFER
// resolver must refuse to build a no-timeout MsgTransfer (missing
// ibcDenomTraces => timeoutTimestamp falls back to 0, and
// timeoutHeight is always {0,0} here) and must refuse a malformed
// sourceChannel parsed out of the memo.
describe('getCosmosSigningInputs IBC transfer guards', () => {
  let walletCore: WalletCore
  let sender: string
  let recipient: string
  let publicKeyHex: string

  beforeAll(async () => {
    walletCore = await initWasm()

    const privateKey = walletCore.PrivateKey.createWithData(new Uint8Array(32).fill(1))
    const recipientPrivateKey = walletCore.PrivateKey.createWithData(new Uint8Array(32).fill(2))
    const publicKey = privateKey.getPublicKeySecp256k1(false)
    const recipientPublicKey = recipientPrivateKey.getPublicKeySecp256k1(false)

    sender = walletCore.AnyAddress.createWithPublicKey(publicKey, walletCore.CoinType.cosmos).description()
    recipient = walletCore.AnyAddress.createWithPublicKey(recipientPublicKey, walletCore.CoinType.cosmos).description()
    publicKeyHex = Buffer.from(publicKey.data()).toString('hex')
  })

  const buildPayload = ({
    memo,
    ibcDenomTraces,
  }: {
    memo: string
    ibcDenomTraces?: { path: string; baseDenom: string; latestBlock: string }
  }) =>
    create(KeysignPayloadSchema, {
      coin: create(CoinSchema, {
        chain: Chain.Cosmos,
        ticker: 'ATOM',
        address: sender,
        contractAddress: '',
        decimals: 6,
        isNativeToken: true,
        hexPublicKey: publicKeyHex,
      }),
      toAddress: recipient,
      toAmount: '12345',
      memo,
      blockchainSpecific: {
        case: 'cosmosSpecific',
        value: create(CosmosSpecificSchema, {
          accountNumber: 7n,
          sequence: 3n,
          gas: 2500n,
          transactionType: TransactionType.IBC_TRANSFER,
          ibcDenomTraces: ibcDenomTraces ? create(CosmosIbcDenomTraceSchema, ibcDenomTraces) : undefined,
        }),
      },
    })

  it('refuses to build a no-timeout MsgTransfer when ibcDenomTraces is missing (COSMOS-01)', () => {
    expect(() =>
      getCosmosSigningInputs({
        keysignPayload: buildPayload({ memo: 'transfer:channel-141' }),
        walletCore,
      })
    ).toThrow(/refusing to build a no-timeout MsgTransfer/)
  })

  it('refuses to build when ibcDenomTraces.latestBlock is present but empty (COSMOS-01)', () => {
    expect(() =>
      getCosmosSigningInputs({
        keysignPayload: buildPayload({
          memo: 'transfer:channel-141',
          ibcDenomTraces: { path: 'transfer/channel-141', baseDenom: 'uatom', latestBlock: '' },
        }),
        walletCore,
      })
    ).toThrow(/refusing to build a no-timeout MsgTransfer/)
  })

  it('builds successfully with a non-zero timeout when the denom trace is present (regression guard)', async () => {
    const [input] = await getCosmosSigningInputs({
      keysignPayload: buildPayload({
        memo: 'transfer:channel-141',
        ibcDenomTraces: { path: 'transfer/channel-141', baseDenom: 'uatom', latestBlock: '12345_1751328000000000000' },
      }),
      walletCore,
    })

    const transfer = input.messages[0].transferTokensMessage
    expect(transfer).toBeDefined()
    expect(transfer!.sourceChannel).toBe('channel-141')
    expect(transfer!.timeoutTimestamp.toString()).toBe('1751328000000000000')
    expect(transfer!.timeoutTimestamp.isZero()).toBe(false)
  })

  it('refuses to build when the memo channel is malformed (COSMOS-03)', () => {
    expect(() =>
      getCosmosSigningInputs({
        keysignPayload: buildPayload({
          memo: 'transfer:not-a-channel',
          ibcDenomTraces: {
            path: 'transfer/channel-141',
            baseDenom: 'uatom',
            latestBlock: '12345_1751328000000000000',
          },
        }),
        walletCore,
      })
    ).toThrow(/well-formed source channel/)
  })

  it('refuses to build when the memo has no channel segment at all (COSMOS-03)', () => {
    expect(() =>
      getCosmosSigningInputs({
        keysignPayload: buildPayload({
          memo: 'transfer',
          ibcDenomTraces: {
            path: 'transfer/channel-141',
            baseDenom: 'uatom',
            latestBlock: '12345_1751328000000000000',
          },
        }),
        walletCore,
      })
    ).toThrow(/well-formed source channel/)
  })
})
