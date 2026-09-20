import { Buffer } from 'buffer'
import { create } from '@bufbuild/protobuf'
import { TW, type WalletCore } from '@trustwallet/wallet-core'
import { Chain } from '@vultisig/core-chain/Chain'
import { OneInchSwapPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/1inch_swap_payload_pb'
import { TronSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { CoinSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/coin_pb'
import { KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { TronTransferContractPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/tron_contract_payload_pb'
import { THORChainSwapPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/thorchain_swap_payload_pb'
import Long from 'long'
import { describe, expect, it } from 'vitest'

import { getTronSigningInputs } from './tron'

// getTronSigningInputs does not use walletCore internally (no address
// validation or signing helpers required for Tron system ops), so a
// bare cast to satisfy the resolver type constraint is fine here.
const walletCore = {} as unknown as WalletCore

// Minimal TronSpecific with a nonzero gasEstimation so we can assert which
// branches forward it to feeLimit (staking ops do, the expired-unfreeze claim
// does not).
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
  gasEstimation = 999n,
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
  gasEstimation?: bigint
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
      value: makeTronSpecific(gasEstimation),
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

describe('getTronSigningInputs -- FREEZE: / UNFREEZE: feeLimit agreement (sdk#2269)', () => {
  // fee_limit is a raw_data field. Android (TronHelper.buildStakingTransaction)
  // and iOS (Tron.swift) sign the payload's gasEstimation for FreezeBalanceV2 /
  // UnfreezeBalanceV2, so the SDK must serialize the same value or a
  // desktop/extension co-signer hashes a different preimage than the mobile
  // initiator in the same ceremony. The value itself is irrelevant to the node.
  const GAS_ESTIMATION = 100_000_000n

  it.each(['FREEZE:BANDWIDTH', 'FREEZE:ENERGY', 'UNFREEZE:BANDWIDTH', 'UNFREEZE:ENERGY'])(
    '%s signs feeLimit = tronSpecific.gasEstimation',
    async memo => {
      const [input] = await getTronSigningInputs({ keysignPayload: buildPayload(memo), walletCore })
      expect(input.transaction?.feeLimit?.toString()).toBe(GAS_ESTIMATION.toString())
      expect(input.transaction?.feeLimit?.equals(Long.ZERO)).toBe(false)
    }
  )

  it('FREEZE feeLimit tracks the payload value rather than a constant', async () => {
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
      blockchainSpecific: { case: 'tronSpecific', value: makeTronSpecific(800_000n) },
    })

    const [input] = await getTronSigningInputs({ keysignPayload: payload, walletCore })
    expect(input.transaction?.feeLimit?.toString()).toBe('800000')
  })

  it('FREEZE / UNFREEZE feeLimit throws instead of silently wrapping an out-of-int64-range gasEstimation', () => {
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
      memo: 'UNFREEZE:BANDWIDTH',
      blockchainSpecific: { case: 'tronSpecific', value: makeTronSpecific(1n << 63n) },
    })

    expect(() => getTronSigningInputs({ keysignPayload: payload, walletCore })).toThrow(/out of int64 range/)
  })

  it('branches that never serialize feeLimit still accept a uint64 gasEstimation beyond int64', async () => {
    const gasEstimation = 1n << 63n
    const claim = buildWithdrawExpireUnfreezePayload({ gasEstimation })
    const nativeSend = create(KeysignPayloadSchema, {
      coin: create(CoinSchema, {
        chain: Chain.Tron,
        ticker: 'TRX',
        address: OWNER,
        decimals: 6,
        isNativeToken: true,
      }),
      toAddress: OWNER,
      toAmount: '1000000',
      blockchainSpecific: { case: 'tronSpecific', value: makeTronSpecific(gasEstimation) },
    })

    const [claimInput] = await getTronSigningInputs({ keysignPayload: claim, walletCore })
    expect(claimInput.transaction?.feeLimit?.equals(Long.ZERO)).toBe(true)

    const [sendInput] = await getTronSigningInputs({ keysignPayload: nativeSend, walletCore })
    expect(sendInput.transaction?.transfer?.amount?.toString()).toBe('1000000')
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

const buildTrc20Payload = (toAmount: string, swap: boolean) => {
  const payload = buildPayload('amount memo', toAmount)
  payload.coin!.isNativeToken = false
  payload.coin!.contractAddress = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
  if (swap) {
    payload.swapPayload = {
      case: 'thorchainSwapPayload',
      value: create(THORChainSwapPayloadSchema, { fromCoin: payload.coin, vaultAddress: OWNER }),
    }
  }
  return payload
}

describe.each([false, true])('Tron TRC20 amount validation (swap=%s)', swap => {
  it.each(['', ' ', '\t\n', '0x10', '+1', '-1', '-0', '1.5', '1e3'])('rejects malformed amount %j', async toAmount => {
    await expect(async () =>
      getTronSigningInputs({ keysignPayload: buildTrc20Payload(toAmount, swap), walletCore })
    ).rejects.toThrow(/decimal/)
  })

  it('preserves an amount above uint64 and its memo', async () => {
    const [input] = await getTronSigningInputs({
      keysignPayload: buildTrc20Payload('18446744073709551616', swap),
      walletCore,
    })
    expect(Buffer.from(input.transaction!.transferTrc20Contract!.amount!).toString('hex')).toBe('010000000000000000')
    expect(input.transaction!.memo).toBe('amount memo')
  })
})

// Confirmed successful USDT transfer; amount word obtained from TronGrid gettransactionbyid.
// https://tronscan.org/transaction/675b58c8e36c73f2e22e0791e991cb819f8c8d355e6b42f8227a34e86f4c313f/overview
// Full calldata: a9059cbb0000000000000000000000419c826361267bc0a68f5237ba435ddb0a471afb6e000000000000000000000000000000000000000000000000000000000092a310
it.each([false, true])('matches the on-chain USDT amount word (swap=%s)', async swap => {
  const [input] = await getTronSigningInputs({ keysignPayload: buildTrc20Payload('9610000', swap), walletCore })
  const amount = Buffer.from(input.transaction!.transferTrc20Contract!.amount!).toString('hex')
  expect(amount.padStart(64, '0')).toBe('000000000000000000000000000000000000000000000000000000000092a310')
})
