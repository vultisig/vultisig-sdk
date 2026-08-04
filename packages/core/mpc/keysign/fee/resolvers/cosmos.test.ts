import { Buffer } from 'buffer'

import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import {
  CosmosSpecificSchema,
  MAYAChainSpecificSchema,
  THORChainSpecificSchema,
  TransactionType,
} from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { CoinSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/coin_pb'
import { KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCosmosRpcUrl: vi.fn(),
  queryUrl: vi.fn(),
}))

vi.mock('@vultisig/core-chain/chains/cosmos/getCosmosRpcUrl', () => ({
  getCosmosRpcUrl: mocks.getCosmosRpcUrl,
}))

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: mocks.queryUrl,
}))

import { getCosmosFeeAmount } from './cosmos'

const SENDER = 'cosmos1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqjturm7'
const RECEIVER = 'cosmos1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqp3z0y6'

const buildVaultInput = (chain: typeof Chain.THORChain | typeof Chain.MayaChain, fee = 2_000_000n) => ({
  keysignPayload: create(KeysignPayloadSchema, {
    coin: create(CoinSchema, {
      chain,
      ticker: chain === Chain.THORChain ? 'RUNE' : 'CACAO',
      address: SENDER,
      contractAddress: '',
      decimals: chain === Chain.THORChain ? 8 : 10,
      isNativeToken: true,
    }),
    toAddress: RECEIVER,
    toAmount: '12345',
    blockchainSpecific:
      chain === Chain.THORChain
        ? {
            case: 'thorchainSpecific' as const,
            value: create(THORChainSpecificSchema, { fee }),
          }
        : {
            case: 'mayaSpecific' as const,
            value: create(MAYAChainSpecificSchema),
          },
  }),
  walletCore: {} as never,
  publicKey: {} as never,
})

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
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCosmosRpcUrl.mockReturnValue('https://mayanode.mayachain.info')
  })

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

  it('reads the THORChain display fee from the keysign payload without a network lookup', () => {
    expect(getCosmosFeeAmount(buildVaultInput(Chain.THORChain, 3_000_000n))).toBe(3_000_000n)
    expect(mocks.queryUrl).not.toHaveBeenCalled()
  })

  it('reads the MayaChain display fee from the live Mimir override', async () => {
    mocks.queryUrl.mockResolvedValueOnce({ NATIVETRANSACTIONFEE: 3_000_000_000 })

    await expect(getCosmosFeeAmount(buildVaultInput(Chain.MayaChain))).resolves.toBe(3_000_000_000n)
    expect(mocks.queryUrl).toHaveBeenCalledOnce()
    expect(mocks.queryUrl).toHaveBeenCalledWith('https://mayanode.mayachain.info/mayachain/mimir')
  })

  it('reads the MayaChain default constant when Mimir is negative', async () => {
    mocks.queryUrl
      .mockResolvedValueOnce({ NATIVETRANSACTIONFEE: -2 })
      .mockResolvedValueOnce({ int_64_values: { NativeTransactionFee: 2_500_000_000 } })

    await expect(getCosmosFeeAmount(buildVaultInput(Chain.MayaChain))).resolves.toBe(2_500_000_000n)
    expect(mocks.queryUrl).toHaveBeenNthCalledWith(2, 'https://mayanode.mayachain.info/mayachain/constants')
  })

  it('preserves a zero MayaChain Mimir fee instead of replacing it with the default', async () => {
    mocks.queryUrl.mockResolvedValueOnce({ NATIVETRANSACTIONFEE: 0 })

    await expect(getCosmosFeeAmount(buildVaultInput(Chain.MayaChain))).resolves.toBe(0n)
    expect(mocks.queryUrl).toHaveBeenCalledOnce()
  })

  it('reads MayaChain governance data through the configured RPC override', async () => {
    mocks.getCosmosRpcUrl.mockReturnValue('https://maya-rpc.example')
    mocks.queryUrl.mockResolvedValueOnce({ NATIVETRANSACTIONFEE: 3_000_000_000 })

    await expect(getCosmosFeeAmount(buildVaultInput(Chain.MayaChain))).resolves.toBe(3_000_000_000n)
    expect(mocks.queryUrl).toHaveBeenCalledWith('https://maya-rpc.example/mayachain/mimir')
  })

  it('rejects a malformed live MayaChain fee instead of showing stale or unsafe data', async () => {
    mocks.queryUrl.mockResolvedValueOnce({ NATIVETRANSACTIONFEE: 'not-a-fee' })

    await expect(getCosmosFeeAmount(buildVaultInput(Chain.MayaChain))).rejects.toThrow(
      'MayaChain Mimir NativeTransactionFee is not an integer'
    )
  })

  it('rejects coercible non-numeric MayaChain fee values', async () => {
    mocks.queryUrl.mockResolvedValueOnce({ NATIVETRANSACTIONFEE: false })

    await expect(getCosmosFeeAmount(buildVaultInput(Chain.MayaChain))).rejects.toThrow(
      'MayaChain Mimir NativeTransactionFee is not an integer'
    )
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
