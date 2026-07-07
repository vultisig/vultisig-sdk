import { Buffer } from 'buffer'

import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { initWasm, type WalletCore } from '@trustwallet/wallet-core'
import {
  CosmosSpecificSchema,
  THORChainSpecificSchema,
  TransactionType,
} from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { CoinSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/coin_pb'
import { KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { beforeAll, describe, expect, it } from 'vitest'

import { getCosmosSigningInputs } from './cosmos'

describe('getCosmosSigningInputs gas limit', () => {
  let walletCore: WalletCore
  let sender: string
  let recipient: string
  let thorSender: string
  let thorRecipient: string
  let publicKeyHex: string

  beforeAll(async () => {
    walletCore = await initWasm()

    const privateKey = walletCore.PrivateKey.createWithData(new Uint8Array(32).fill(1))
    const recipientPrivateKey = walletCore.PrivateKey.createWithData(new Uint8Array(32).fill(2))
    const publicKey = privateKey.getPublicKeySecp256k1(false)
    const recipientPublicKey = recipientPrivateKey.getPublicKeySecp256k1(false)

    sender = walletCore.AnyAddress.createWithPublicKey(publicKey, walletCore.CoinType.cosmos).description()
    recipient = walletCore.AnyAddress.createWithPublicKey(recipientPublicKey, walletCore.CoinType.cosmos).description()
    thorSender = walletCore.AnyAddress.createWithPublicKey(publicKey, walletCore.CoinType.thorchain).description()
    thorRecipient = walletCore.AnyAddress.createWithPublicKey(
      recipientPublicKey,
      walletCore.CoinType.thorchain
    ).description()
    publicKeyHex = Buffer.from(publicKey.data()).toString('hex')
  })

  const buildPayload = ({ gasLimit }: { gasLimit?: bigint }) =>
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
      memo: 'gas limit regression',
      blockchainSpecific: {
        case: 'cosmosSpecific',
        value: create(CosmosSpecificSchema, {
          accountNumber: 7n,
          sequence: 3n,
          gas: 2500n,
          gasLimit,
          transactionType: TransactionType.UNSPECIFIED,
        }),
      },
    })

  const feeFor = async (gasLimit?: bigint) => {
    const [input] = await getCosmosSigningInputs({
      keysignPayload: buildPayload({ gasLimit }),
      walletCore,
    })

    return {
      amount: input.fee?.amounts?.[0]?.amount,
      gas: input.fee?.gas.toString(),
    }
  }

  it('honors a positive relayed CosmosSpecific gas limit', async () => {
    await expect(feeFor(345_678n)).resolves.toEqual({
      amount: '4321',
      gas: '345678',
    })
  })

  it('falls back to the static per-chain gas limit when the relayed value is missing or zero', async () => {
    await expect(feeFor()).resolves.toEqual({
      amount: '2500',
      gas: '200000',
    })
    await expect(feeFor(0n)).resolves.toEqual({
      amount: '2500',
      gas: '200000',
    })
  })

  it('keeps vault-based Cosmos chains on their static gas limit', async () => {
    const [input] = await getCosmosSigningInputs({
      keysignPayload: create(KeysignPayloadSchema, {
        coin: create(CoinSchema, {
          chain: Chain.THORChain,
          ticker: 'RUNE',
          address: thorSender,
          contractAddress: '',
          decimals: 8,
          isNativeToken: true,
          hexPublicKey: publicKeyHex,
        }),
        toAddress: thorRecipient,
        toAmount: '12345',
        memo: 'vault based gas regression',
        blockchainSpecific: {
          case: 'thorchainSpecific',
          value: create(THORChainSpecificSchema, {
            accountNumber: 7n,
            sequence: 3n,
            fee: 2_000_000n,
            isDeposit: false,
            transactionType: TransactionType.UNSPECIFIED,
          }),
        },
      }),
      walletCore,
    })

    expect(input.fee?.gas.toString()).toBe('20000000')
  })
})
