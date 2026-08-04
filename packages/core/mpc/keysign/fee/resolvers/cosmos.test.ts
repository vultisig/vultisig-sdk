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

const buildInput = ({
  transactionType,
  gas = 2500n,
  gasLimit,
}: {
  transactionType: TransactionType
  gas?: bigint
  gasLimit?: bigint
}) => ({
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
        gasLimit,
        transactionType,
      }),
    },
  }),
  walletCore: {} as never,
  publicKey: {} as never,
})

describe('getCosmosFeeAmount', () => {
  it('displays CosmosSpecific.gas verbatim — it is the fee AMOUNT (proto field 3)', () => {
    expect(getCosmosFeeAmount(buildInput({ transactionType: TransactionType.UNSPECIFIED, gas: 2500n }))).toBe(2500n)
  })

  it('does not re-derive the amount from a relayed gas limit', () => {
    // Field 7 moves the signed gas LIMIT only. The initiator already priced
    // `gas` against it, so rescaling here would show a fee no other client signs.
    expect(
      getCosmosFeeAmount(buildInput({ transactionType: TransactionType.UNSPECIFIED, gas: 2500n, gasLimit: 345_678n }))
    ).toBe(2500n)
  })

  it('does not double the displayed fee for an IBC transfer', () => {
    // COSMOS-02 headroom is applied by the initiator (widened `gas_limit` plus a
    // fee priced for it), never here — the read side has no proto field
    // carrying a multiplier, so iOS / Android could not reproduce one.
    expect(getCosmosFeeAmount(buildInput({ transactionType: TransactionType.IBC_TRANSFER, gas: 2500n }))).toBe(2500n)
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
          // An initiator-widened IBC limit (static 200_000 × IBC_GAS_MULTIPLIER)
          // exercises the path where display and signing could drift apart.
          gasLimit: 400_000n,
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

    expect(signingInput.fee?.amounts?.[0]?.amount).toBe(displayedFee.toString())
    expect(displayedFee).toBe(2500n)
    expect(signingInput.fee?.gas.toString()).toBe('400000')
  })

  it('includes the TerraClassic USTC burn tax in the display total exactly when signing includes it', async () => {
    const { getCosmosSigningInputs } = await import('../../signingInputs/resolvers/cosmos')
    const { initWasm } = await import('@trustwallet/wallet-core')
    const { CosmosIbcDenomTraceSchema } =
      await import('@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb')
    const { CosmosCoinSchema, CosmosFeeSchema, SignAminoSchema } =
      await import('@vultisig/core-mpc/types/vultisig/keysign/v1/wasm_execute_contract_payload_pb')

    const walletCore = await initWasm()
    const privateKey = walletCore.PrivateKey.createWithData(new Uint8Array(32).fill(1))
    const publicKey = privateKey.getPublicKeySecp256k1(true)
    const sender = walletCore.AnyAddress.createWithPublicKey(publicKey, walletCore.CoinType.terra).description()

    const keysignPayload = create(KeysignPayloadSchema, {
      coin: create(CoinSchema, {
        chain: Chain.TerraClassic,
        ticker: 'USTC',
        address: sender,
        contractAddress: 'uusd',
        decimals: 6,
        isNativeToken: false,
        hexPublicKey: Buffer.from(publicKey.data()).toString('hex'),
      }),
      toAddress: sender,
      toAmount: '10000000',
      blockchainSpecific: {
        case: 'cosmosSpecific',
        value: create(CosmosSpecificSchema, {
          accountNumber: 7n,
          sequence: 3n,
          gas: 8_497_500n,
          transactionType: TransactionType.UNSPECIFIED,
          ibcDenomTraces: create(CosmosIbcDenomTraceSchema, {
            baseDenom: '120000',
          }),
        }),
      },
    })

    const displayedFee = getCosmosFeeAmount({ keysignPayload, walletCore: {} as never, publicKey: {} as never })
    const [signingInput] = await getCosmosSigningInputs({ keysignPayload, walletCore })
    const signedFeeAmounts = signingInput.fee?.amounts ?? []

    expect(signedFeeAmounts.map(({ amount, denom }) => ({ amount, denom }))).toEqual([
      { amount: '8497500', denom: 'uluna' },
      { amount: '120000', denom: 'uusd' },
    ])
    expect(displayedFee).toBe(8_617_500n)
    expect(displayedFee).toBe(signedFeeAmounts.reduce((total, { amount }) => total + BigInt(amount ?? '0'), 0n))

    keysignPayload.signData = {
      case: 'signAmino',
      value: create(SignAminoSchema, {
        fee: create(CosmosFeeSchema, {
          gas: '300000',
          amount: [create(CosmosCoinSchema, { amount: '8497500', denom: 'uluna' })],
        }),
      }),
    }
    const dappDisplayedFee = getCosmosFeeAmount({
      keysignPayload,
      walletCore: {} as never,
      publicKey: {} as never,
    })
    const [dappSigningInput] = await getCosmosSigningInputs({ keysignPayload, walletCore })

    expect(dappSigningInput.fee?.amounts?.map(({ amount, denom }) => ({ amount, denom }))).toEqual([
      { amount: '8497500', denom: 'uluna' },
    ])
    expect(dappDisplayedFee).toBe(8_497_500n)
  })
})
