import { Buffer } from 'buffer'

import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import {
  CosmosSpecificSchema,
  TransactionType,
} from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { CoinSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/coin_pb'
import { KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { describe, expect, it } from 'vitest'

import { getCosmosFeeAmount } from './cosmos'

const SENDER = 'cosmos1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqjturm7'
const RECEIVER = 'cosmos1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqp3z0y6'

const buildInput = ({ transactionType, gas = 2500n }: { transactionType: TransactionType; gas?: bigint }) => ({
  keysignPayload: create(KeysignPayloadSchema, {
    coin: create(CoinSchema, {
      chain: Chain.Cosmos,
      ticker: 'ATOM',
      address: SENDER,
      contractAddress: '',
      decimals: 6,
      isNativeToken: true,
    }),
    toAddress: RECEIVER,
    toAmount: '12345',
    memo: 'transfer:channel-141',
    blockchainSpecific: {
      case: 'cosmosSpecific' as const,
      value: create(CosmosSpecificSchema, {
        accountNumber: 7n,
        sequence: 3n,
        gas,
        transactionType,
      }),
    },
  }),
  walletCore: {} as never,
  publicKey: {} as never,
})

describe('getCosmosFeeAmount COSMOS-02: IBC gas multiplier', () => {
  it('doubles the displayed fee for an IBC transfer', () => {
    expect(getCosmosFeeAmount(buildInput({ transactionType: TransactionType.IBC_TRANSFER, gas: 2500n }))).toBe(5000n)
  })

  it('leaves the displayed fee unchanged for a plain (non-IBC) send on the same ibc-enabled chain', () => {
    expect(getCosmosFeeAmount(buildInput({ transactionType: TransactionType.UNSPECIFIED, gas: 2500n }))).toBe(2500n)
  })

  it('matches the signing-inputs resolver so the displayed fee never drifts from the signed fee', async () => {
    const { getCosmosSigningInputs } = await import('../../signingInputs/resolvers/cosmos')
    const { initWasm } = await import('@trustwallet/wallet-core')
    const { CosmosIbcDenomTraceSchema } =
      await import('@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb')

    const walletCore = await initWasm()
    const privateKey = walletCore.PrivateKey.createWithData(new Uint8Array(32).fill(1))
    const publicKey = privateKey.getPublicKeySecp256k1(false)
    const sender = walletCore.AnyAddress.createWithPublicKey(publicKey, walletCore.CoinType.cosmos).description()

    const keysignPayload = create(KeysignPayloadSchema, {
      coin: create(CoinSchema, {
        chain: Chain.Cosmos,
        ticker: 'ATOM',
        address: sender,
        contractAddress: '',
        decimals: 6,
        isNativeToken: true,
        hexPublicKey: Buffer.from(publicKey.data()).toString('hex'),
      }),
      toAddress: RECEIVER,
      toAmount: '12345',
      memo: 'transfer:channel-141',
      blockchainSpecific: {
        case: 'cosmosSpecific',
        value: create(CosmosSpecificSchema, {
          accountNumber: 7n,
          sequence: 3n,
          gas: 2500n,
          transactionType: TransactionType.IBC_TRANSFER,
          ibcDenomTraces: create(CosmosIbcDenomTraceSchema, {
            path: 'transfer/channel-141',
            baseDenom: 'uatom',
            latestBlock: '12345_1751328000000000000',
          }),
        }),
      },
    })

    const displayedFee = getCosmosFeeAmount({ keysignPayload, walletCore: {} as never, publicKey: {} as never })

    const [signingInput] = await getCosmosSigningInputs({ keysignPayload, walletCore })

    expect(displayedFee).toBe(5000n)
    expect(signingInput.fee?.amounts?.[0]?.amount).toBe('5000')
  })
})
