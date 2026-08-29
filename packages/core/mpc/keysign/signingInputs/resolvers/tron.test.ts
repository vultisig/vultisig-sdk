import { Buffer } from 'buffer'
import { create } from '@bufbuild/protobuf'
import { TW, type WalletCore } from '@trustwallet/wallet-core'
import { Chain } from '@vultisig/core-chain/Chain'
import { OneInchSwapPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/1inch_swap_payload_pb'
import { TronSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { CoinSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/coin_pb'
import { KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { TronTransferContractPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/tron_contract_payload_pb'
import Long from 'long'
import { describe, expect, it } from 'vitest'

import { getTronSigningInputs } from './tron'

// getTronSigningInputs does not use walletCore internally (no address
// validation or signing helpers required for Tron system ops), so a
// bare cast to satisfy the resolver type constraint is fine here.
const walletCore = {} as unknown as WalletCore

// Minimal TronSpecific with a nonzero gasEstimation so we can assert
// it is NOT forwarded to feeLimit in system-contract branches.
const makeTronSpecific = (gasEstimation = 100_000_000n) =>
  create(TronSpecificSchema, {
    timestamp: 1_700_000_000_000n,
    expiration: 1_700_003_600_000n,
    blockHeaderTimestamp: 1_699_999_940_000n,
    blockHeaderNumber: 1234n,
    blockHeaderVersion: 28n,
    blockHeaderTxTrieRoot: '0000000000000000000000000000000000000000000000000000000000000000',
    blockHeaderParentHash: '0000000000000000000000000000000000000000000000000000000000000000',
    blockHeaderWitnessAddress: '0000000000000000000000000000000000000000',
    gasEstimation,
  })

const OWNER = 'T9yED5xMV5ARV98BexN97aLZ1UUq7eKSxm'
const WITHDRAW_EXPIRE_UNFREEZE_MEMO = 'WITHDRAW_EXPIRE_UNFREEZE'

const buildPayload = (memo: string, toAmount = '1000000000') =>
  create(KeysignPayloadSchema, {
    coin: create(CoinSchema, {
      chain: Chain.Tron,
      ticker: 'TRX',
      address: OWNER,
      decimals: 6,
      isNativeToken: true,
    }),
    toAddress: OWNER,
    toAmount,
    memo,
    blockchainSpecific: {
      case: 'tronSpecific',
      value: makeTronSpecific(100_000_000n),
    },
  })

const buildWithdrawExpireUnfreezePayload = ({
  chain = Chain.Tron,
  ticker = 'TRX',
  isNativeToken = true,
  contractAddress = '',
  toAddress = OWNER,
  toAmount = '1000000000',
  memo = WITHDRAW_EXPIRE_UNFREEZE_MEMO,
  withContractPayload = false,
  withSwapPayload = false,
}: {
  chain?: Chain
  ticker?: string
  isNativeToken?: boolean
  contractAddress?: string
  toAddress?: string
  toAmount?: string
  memo?: string
  withContractPayload?: boolean
  withSwapPayload?: boolean
} = {}) =>
  create(KeysignPayloadSchema, {
    coin: create(CoinSchema, {
      chain,
      ticker,
      address: OWNER,
      decimals: 6,
      isNativeToken,
      contractAddress,
    }),
    toAddress,
    toAmount,
    memo,
    blockchainSpecific: {
      case: 'tronSpecific',
      value: makeTronSpecific(999n),
    },
    contractPayload: withContractPayload
      ? {
          case: 'tronTransferContractPayload',
          value: create(TronTransferContractPayloadSchema, {
            ownerAddress: OWNER,
            toAddress: OWNER,
            amount: '1',
          }),
        }
      : undefined,
    swapPayload: withSwapPayload
      ? {
          case: 'oneinchSwapPayload',
          value: create(OneInchSwapPayloadSchema),
        }
      : undefined,
  })

describe('getTronSigningInputs -- WithdrawExpireUnfreezeContract', () => {
  it('constructs the exact owner-only WalletCore transaction shape', async () => {
    const [input] = await getTronSigningInputs({
      keysignPayload: buildWithdrawExpireUnfreezePayload(),
      walletCore,
    })

    const transaction = input.transaction as TW.Tron.Proto.Transaction | undefined
    expect(transaction?.contractOneof).toBe('withdrawExpireUnfreeze')
    expect(transaction?.withdrawExpireUnfreeze?.ownerAddress).toBe(OWNER)
    expect(
      TW.Tron.Proto.WithdrawExpireUnfreezeContract.toObject(
        TW.Tron.Proto.WithdrawExpireUnfreezeContract.create(transaction!.withdrawExpireUnfreeze!)
      )
    ).toEqual({ ownerAddress: OWNER })
    expect(transaction?.timestamp?.toString()).toBe('1700000000000')
    expect(transaction?.expiration?.toString()).toBe('1700003600000')
    expect(transaction?.feeLimit?.equals(Long.ZERO)).toBe(true)
    expect(transaction?.memo).toBe('')
    expect(transaction?.transfer).toBeNull()
    expect(transaction?.unfreezeBalanceV2).toBeNull()
    expect(transaction?.blockHeader?.timestamp?.toString()).toBe('1699999940000')
    expect(transaction?.blockHeader?.number?.toString()).toBe('1234')
    expect(transaction?.blockHeader?.version).toBe(28)
    expect(transaction?.blockHeader?.txTrieRoot).toEqual(Buffer.alloc(32))
    expect(transaction?.blockHeader?.parentHash).toEqual(Buffer.alloc(32))
    expect(transaction?.blockHeader?.witnessAddress).toEqual(Buffer.alloc(20))
  })

  it('matches the encoded WalletCore golden and decodes back to the same claim', async () => {
    const [input] = await getTronSigningInputs({
      keysignPayload: buildWithdrawExpireUnfreezePayload(),
      walletCore,
    })

    const encoded = TW.Tron.Proto.SigningInput.encode(input).finish()
    expect(Buffer.from(encoded).toString('hex')).toBe(
      '0a9f010880d095ffbc311080adf180bd311a6608a0fb91ffbc31122000000000000000000000000000000000000000000000000000000000000000001a20000000000000000000000000000000000000000000000000000000000000000038d2094a140000000000000000000000000000000000000000501c2000ba01240a22543979454435784d563541525639384265784e3937614c5a3155557137654b53786d'
    )

    const decoded = TW.Tron.Proto.SigningInput.decode(encoded)
    const decodedTransaction = decoded.transaction as TW.Tron.Proto.Transaction | undefined
    expect(decodedTransaction?.contractOneof).toBe('withdrawExpireUnfreeze')
    expect(decodedTransaction?.withdrawExpireUnfreeze?.ownerAddress).toBe(OWNER)
    expect(decodedTransaction?.timestamp?.toString()).toBe('1700000000000')
    expect(decodedTransaction?.expiration?.toString()).toBe('1700003600000')
    expect(decodedTransaction?.feeLimit?.equals(Long.ZERO)).toBe(true)
    expect(decodedTransaction?.blockHeader?.number?.toString()).toBe('1234')
  })

  it('keeps arbitrary-size display amounts out of the serialized contract', async () => {
    const amounts = ['0', '12500000', '900719925474099300000000000000000000000000000000001']
    const encoded = await Promise.all(
      amounts.map(async toAmount => {
        const [input] = await getTronSigningInputs({
          keysignPayload: buildWithdrawExpireUnfreezePayload({ toAmount }),
          walletCore,
        })
        return Buffer.from(TW.Tron.Proto.SigningInput.encode(input).finish()).toString('hex')
      })
    )

    expect(new Set(encoded).size).toBe(1)
  })

  it.each([
    ['non-native token', { isNativeToken: false, contractAddress: OWNER }],
    ['wrong ticker', { ticker: 'USDT' }],
    ['wrong chain', { chain: Chain.Ethereum }],
    ['native coin with a contract address', { contractAddress: OWNER }],
    ['foreign destination', { toAddress: 'TDifferentRecipient' }],
    ['empty amount', { toAmount: '' }],
    ['negative amount', { toAmount: '-1' }],
    ['decimal amount', { toAmount: '1.5' }],
    ['exponential amount', { toAmount: '1e3' }],
    ['whitespace amount', { toAmount: ' 1' }],
    ['memo suffix collision', { memo: `${WITHDRAW_EXPIRE_UNFREEZE_MEMO}:1` }],
    ['contract payload collision', { withContractPayload: true }],
    ['swap payload collision', { withSwapPayload: true }],
  ] as const)('rejects %s', (_label, overrides) => {
    expect(() =>
      getTronSigningInputs({
        keysignPayload: buildWithdrawExpireUnfreezePayload(overrides),
        walletCore,
      })
    ).toThrow('Invalid TRON expired-unfreeze claim payload')
  })
})

describe('getTronSigningInputs -- FREEZE: / UNFREEZE: feeLimit semantics (BUG-7)', () => {
  it('FREEZE:BANDWIDTH sets feeLimit to 0 regardless of gasEstimation', async () => {
    const [input] = await getTronSigningInputs({ keysignPayload: buildPayload('FREEZE:BANDWIDTH'), walletCore })
    // FreezeBalanceV2 is a bandwidth op; energy feeLimit is semantically irrelevant.
    expect(input.transaction?.feeLimit?.toNumber()).toBe(0)
  })

  it('FREEZE:ENERGY sets feeLimit to 0 regardless of gasEstimation', async () => {
    const [input] = await getTronSigningInputs({ keysignPayload: buildPayload('FREEZE:ENERGY'), walletCore })
    expect(input.transaction?.feeLimit?.toNumber()).toBe(0)
  })

  it('UNFREEZE:BANDWIDTH sets feeLimit to 0 regardless of gasEstimation', async () => {
    const [input] = await getTronSigningInputs({ keysignPayload: buildPayload('UNFREEZE:BANDWIDTH'), walletCore })
    expect(input.transaction?.feeLimit?.toNumber()).toBe(0)
  })

  it('UNFREEZE:ENERGY sets feeLimit to 0 regardless of gasEstimation', async () => {
    const [input] = await getTronSigningInputs({ keysignPayload: buildPayload('UNFREEZE:ENERGY'), walletCore })
    expect(input.transaction?.feeLimit?.toNumber()).toBe(0)
  })

  it('gasEstimation value does not leak into FREEZE feeLimit', async () => {
    // Pre-fix behaviour: feeLimit would have been Long.fromString('100000000').
    // Post-fix: always 0. This assertion pins the regression explicitly.
    const GAS_ESTIMATION = 100_000_000n
    const specific = makeTronSpecific(GAS_ESTIMATION)
    const payload = create(KeysignPayloadSchema, {
      coin: create(CoinSchema, {
        chain: Chain.Tron,
        ticker: 'TRX',
        address: OWNER,
        decimals: 6,
        isNativeToken: true,
      }),
      toAddress: OWNER,
      toAmount: '1000000000',
      memo: 'FREEZE:ENERGY',
      blockchainSpecific: { case: 'tronSpecific', value: specific },
    })

    const [input] = await getTronSigningInputs({ keysignPayload: payload, walletCore })
    // Anti-regression: prior to fix, feeLimit was passed gasEstimation
    // (a non-zero energy estimate that's semantically meaningless for
    // system contracts and only served to confuse the UI fee display).
    expect(input.transaction?.feeLimit?.equals(Long.ZERO)).toBe(true)
  })
})

describe('getTronSigningInputs -- bounded int64 fee/gas fields (sdk#1200)', () => {
  const buildTriggerSmartContractPayload = ({
    callValue,
    gasEstimation = 100_000_000n,
  }: {
    callValue?: string
    gasEstimation?: bigint
  }) =>
    create(KeysignPayloadSchema, {
      coin: create(CoinSchema, {
        chain: Chain.Tron,
        ticker: 'TRX',
        address: OWNER,
        decimals: 6,
        isNativeToken: true,
      }),
      blockchainSpecific: {
        case: 'tronSpecific',
        value: makeTronSpecific(gasEstimation),
      },
      contractPayload: {
        case: 'tronTriggerSmartContractPayload',
        value: {
          ownerAddress: OWNER,
          contractAddress: OWNER,
          callValue,
          data: '',
        },
      },
    })

  it('feeLimit throws instead of silently wrapping an out-of-int64-range gasEstimation', () => {
    const payload = buildTriggerSmartContractPayload({ gasEstimation: 1n << 63n })
    expect(() => getTronSigningInputs({ keysignPayload: payload, walletCore })).toThrow(/out of int64 range/)
  })

  it('callValue throws instead of silently wrapping an out-of-int64-range value', () => {
    const payload = buildTriggerSmartContractPayload({ callValue: (1n << 63n).toString() })
    expect(() => getTronSigningInputs({ keysignPayload: payload, walletCore })).toThrow(/out of int64 range/)
  })

  it('an in-range feeLimit/callValue still resolves correctly (no false-reject)', async () => {
    const payload = buildTriggerSmartContractPayload({ callValue: '1000000', gasEstimation: 50_000_000n })
    const [input] = await getTronSigningInputs({ keysignPayload: payload, walletCore })

    expect(input.transaction?.feeLimit?.toString()).toBe('50000000')
    expect(input.transaction?.triggerSmartContract?.callValue?.toString()).toBe('1000000')
  })
})
