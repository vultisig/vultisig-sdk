import { create } from '@bufbuild/protobuf'
import { Chain, EvmChain } from '@vultisig/core-chain/Chain'
import { EthereumSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
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
}

const buildPayload = ({ chain = EvmChain.Optimism, amount, contractAddress }: PayloadInput) =>
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
    blockchainSpecific: {
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

    const refined = await refine(buildPayload({ chain: Chain.TerraClassic, amount: balance, contractAddress: 'uusd' }), balance)

    expect(BigInt(refined.toAmount)).toBe(balance - fee)
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
