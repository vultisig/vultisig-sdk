import { create } from '@bufbuild/protobuf'
import { Chain, EvmChain } from '@vultisig/core-chain/Chain'
import { bittensorConfig } from '@vultisig/core-chain/chains/bittensor/config'
import {
  CosmosSpecificSchema,
  EthereumSpecificSchema,
  PolkadotSpecificSchema,
  TransactionType,
} from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getFeeAmount: vi.fn(),
}))

vi.mock('../fee', () => ({
  getFeeAmount: mocks.getFeeAmount,
}))

import { BuildKeysignPayloadError } from '../error'
import { refineKeysignAmount } from './amount'

type PayloadInput = {
  chain?: Chain
  amount: bigint
  contractAddress?: string
  transactionType?: TransactionType
}

const buildPayload = ({
  chain = EvmChain.Optimism,
  amount,
  contractAddress,
  transactionType = TransactionType.UNSPECIFIED,
}: PayloadInput) =>
  create(KeysignPayloadSchema, {
    coin: {
      chain,
      ticker: 'ETH',
      decimals: 18,
      contractAddress,
      address: '0x1111111111111111111111111111111111111111',
    },
    toAddress: '0x2222222222222222222222222222222222222222',
    toAmount: amount.toString(),
    blockchainSpecific:
      chain === Chain.TerraClassic
        ? {
            case: 'cosmosSpecific',
            value: create(CosmosSpecificSchema, {
              accountNumber: 7n,
              sequence: 3n,
              transactionType,
            }),
          }
        : chain === Chain.Bittensor
          ? {
              case: 'polkadotSpecific',
              value: create(PolkadotSpecificSchema, {
                recentBlockHash: '0x' + 'ab'.repeat(32),
                nonce: 1n,
                currentBlockNumber: '4000000',
                specVersion: 458,
                transactionVersion: 1,
                genesisHash: '0x' + 'cd'.repeat(32),
                gas: 200_000n,
              }),
            }
          : {
              case: 'ethereumSpecific',
              value: create(EthereumSpecificSchema, {
                gasLimit: '40000',
                maxFeePerGasWei: '1500000',
                priorityFee: '0',
                nonce: 0n,
              }),
            },
  })

const refine = (keysignPayload: ReturnType<typeof buildPayload>, balance: bigint) =>
  refineKeysignAmount({ keysignPayload, balance, walletCore: {} as never, publicKey: {} as never })

describe('refineKeysignAmount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // The amount the user approved was quoted from one reading of the fee market
  // and the payload carries another. On an L2 with ~2s blocks the base fee has
  // almost always moved in between, and the node then refuses the send with the
  // ceremony already paid for.
  it('refits a balance-derived amount to the fee the payload actually carries', async () => {
    const balance = 12_437_685_400_530_920n
    const quotedFee = 60_000_000_000n
    const signedFee = 62_168_340_514n
    mocks.getFeeAmount.mockResolvedValue(signedFee)

    const refined = await refine(buildPayload({ amount: balance - quotedFee }), balance)

    expect(BigInt(refined.toAmount)).toBe(balance - signedFee)
    expect(BigInt(refined.toAmount) + signedFee).toBeLessThanOrEqual(balance)
  })

  it('clamps down only — a fee that fell must not raise the amount above what was approved', async () => {
    const balance = 12_437_685_400_530_920n
    const approved = balance - 60_000_000_000n
    mocks.getFeeAmount.mockResolvedValue(1_000_000n)

    const refined = await refine(buildPayload({ amount: approved }), balance)

    expect(BigInt(refined.toAmount)).toBe(approved)
  })

  it('leaves a typed amount well inside the balance exactly as entered', async () => {
    mocks.getFeeAmount.mockResolvedValue(60_000_000_000n)

    const refined = await refine(buildPayload({ amount: 1_000_000_000_000_000n }), 12_437_685_400_530_920n)

    expect(refined.toAmount).toBe('1000000000000000')
  })

  // A TAO MAX quoted as `balance - fee` would leave the sender at zero, which
  // transfer_keep_alive refuses on-chain; the refine has to keep the 500 rao
  // existential deposit back so the ceremony signs something the chain accepts.
  it('keeps the existential deposit back on Bittensor so a MAX send cannot reap the sender', async () => {
    const balance = 1_000_000_000n
    const fee = 200_000n
    mocks.getFeeAmount.mockResolvedValue(fee)

    const refined = await refine(buildPayload({ chain: Chain.Bittensor, amount: balance - fee }), balance)

    expect(BigInt(refined.toAmount)).toBe(balance - fee - bittensorConfig.existentialDeposit)
    expect(balance - BigInt(refined.toAmount) - fee).toBeGreaterThanOrEqual(500n)
  })

  it('leaves a Bittensor amount that already keeps the deposit exactly as entered', async () => {
    mocks.getFeeAmount.mockResolvedValue(200_000n)

    const refined = await refine(buildPayload({ chain: Chain.Bittensor, amount: 500_000_000n }), 1_000_000_000n)

    expect(refined.toAmount).toBe('500000000')
  })

  it('refuses a Bittensor send whose balance only covers the fee and the deposit', async () => {
    mocks.getFeeAmount.mockResolvedValue(200_000n)

    await expect(refine(buildPayload({ chain: Chain.Bittensor, amount: 1n }), 200_500n)).rejects.toThrow(
      BuildKeysignPayloadError
    )
  })

  it('refuses before the ceremony when the fee swallows the balance', async () => {
    mocks.getFeeAmount.mockResolvedValue(20_000_000_000n)

    await expect(refine(buildPayload({ amount: 1_000n }), 15_000_000_000n)).rejects.toThrow(BuildKeysignPayloadError)
  })

  it('leaves a token amount untouched, since its gas is paid from the native sibling', async () => {
    mocks.getFeeAmount.mockResolvedValue(60_000_000_000n)
    const tokenBalance = 5_000_000n

    const refined = await refine(
      buildPayload({ amount: tokenBalance, contractAddress: '0x3333333333333333333333333333333333333333' }),
      tokenBalance
    )

    expect(BigInt(refined.toAmount)).toBe(tokenBalance)
    expect(mocks.getFeeAmount).not.toHaveBeenCalled()
  })

  // Regression for #1519: unlike an ordinary token (previous test), USTC
  // (TerraClassic uusd) pays its fee (base gas + burn tax) in uusd itself —
  // the same denom being sent — so a full-balance send must still be refined
  // down, exactly like a native-fee-coin send.
  it('refines a full-balance TerraClassic USTC (uusd) send, since its fee is paid in-kind', async () => {
    const balance = 200_000_000n
    const fee = 1_225_000n
    mocks.getFeeAmount.mockResolvedValue(fee)

    const refined = await refine(
      buildPayload({ chain: Chain.TerraClassic, amount: balance, contractAddress: 'uusd' }),
      balance
    )

    expect(BigInt(refined.toAmount)).toBe(balance - fee)
  })

  // Regression for the CHANGES_REQUESTED review on #1879: an IBC MsgTransfer
  // of USTC still prices CosmosSpecific.gas in uluna (the signing-inputs
  // resolver never relabels it to uusd for IBC), so refining uusd off the
  // amount here — as if the fee were paid in-kind like a plain USTC send —
  // would debit a denom the signing path never priced against. Only a plain
  // TerraClassic bank-send pays its fee in uusd; an IBC transfer must be left
  // untouched, exactly like the ordinary full-balance token case above.
  it('leaves an IBC transfer of TerraClassic USTC untouched — its fee is priced in uluna, not uusd', async () => {
    const balance = 200_000_000n

    const refined = await refine(
      buildPayload({
        chain: Chain.TerraClassic,
        amount: balance,
        contractAddress: 'uusd',
        transactionType: TransactionType.IBC_TRANSFER,
      }),
      balance
    )

    expect(BigInt(refined.toAmount)).toBe(balance)
    expect(mocks.getFeeAmount).not.toHaveBeenCalled()
  })

  it.each([Chain.Bitcoin, Chain.Ton])(
    'leaves %s alone, where the fee comes off the inputs and not the amount',
    async chain => {
      const balance = 100_000n

      const refined = await refine(buildPayload({ chain, amount: balance }), balance)

      expect(BigInt(refined.toAmount)).toBe(balance)
      expect(mocks.getFeeAmount).not.toHaveBeenCalled()
    }
  )

  it('leaves a zero-value transaction alone', async () => {
    const refined = await refine(buildPayload({ amount: 0n }), 12_437_685_400_530_920n)

    expect(refined.toAmount).toBe('0')
    expect(mocks.getFeeAmount).not.toHaveBeenCalled()
  })
})
