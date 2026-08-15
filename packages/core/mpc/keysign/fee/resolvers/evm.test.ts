import { create } from '@bufbuild/protobuf'
import { EvmChain } from '@vultisig/core-chain/Chain'
import { EthereumSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { size } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getOpStackFeeSurcharge: vi.fn(),
}))

vi.mock('@vultisig/core-chain/chains/evm/opStack/getOpStackFeeSurcharge', () => ({
  getOpStackFeeSurcharge: mocks.getOpStackFeeSurcharge,
}))

import { getEvmFeeAmount } from './evm'

type PayloadInput = {
  chain: EvmChain
  gasLimit: bigint
  maxFeePerGasWei: bigint
  memo?: string
}

const buildPayload = ({ chain, gasLimit, maxFeePerGasWei, memo }: PayloadInput) =>
  create(KeysignPayloadSchema, {
    coin: { chain, ticker: chain === EvmChain.Mantle ? 'MNT' : 'ETH', decimals: 18 },
    toAddress: '0x2222222222222222222222222222222222222222',
    toAmount: '1',
    memo,
    blockchainSpecific: {
      case: 'ethereumSpecific',
      value: create(EthereumSpecificSchema, {
        gasLimit: gasLimit.toString(),
        maxFeePerGasWei: maxFeePerGasWei.toString(),
        priorityFee: '0',
        nonce: 0n,
      }),
    },
  })

const feeAmount = (keysignPayload: ReturnType<typeof buildPayload>) =>
  getEvmFeeAmount({ keysignPayload } as never) as Promise<bigint>

describe('getEvmFeeAmount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getOpStackFeeSurcharge.mockResolvedValue(0n)
  })

  it('is the gas the node holds against the sender on a chain with no OP-stack surcharge', async () => {
    const fee = await feeAmount(
      buildPayload({ chain: EvmChain.Arbitrum, gasLimit: 120_000n, maxFeePerGasWei: 24_000n })
    )

    expect(fee).toBe(120_000n * 24_000n)
    expect(mocks.getOpStackFeeSurcharge).not.toHaveBeenCalled()
  })

  it('adds the surcharge op-geth bills on top of gas on an OP-stack chain', async () => {
    mocks.getOpStackFeeSurcharge.mockResolvedValue(2_168_340_514n)

    const fee = await feeAmount(
      buildPayload({ chain: EvmChain.Optimism, gasLimit: 40_000n, maxFeePerGasWei: 1_500_000n })
    )

    expect(fee).toBe(40_000n * 1_500_000n + 2_168_340_514n)
  })

  it('prices the surcharge against the payload gas limit and its calldata', async () => {
    const memo: `0x${string}` = `0x${'ab'.repeat(120)}`

    await feeAmount(buildPayload({ chain: EvmChain.Base, gasLimit: 40_000n, maxFeePerGasWei: 1_000n, memo }))

    expect(mocks.getOpStackFeeSurcharge).toHaveBeenCalledWith({
      chain: EvmChain.Base,
      gasLimit: 40_000n,
      callDataSize: size(memo),
    })
  })

  it('prices a plain transfer with no calldata', async () => {
    await feeAmount(buildPayload({ chain: EvmChain.Optimism, gasLimit: 40_000n, maxFeePerGasWei: 1_000n }))

    expect(mocks.getOpStackFeeSurcharge).toHaveBeenCalledWith(expect.objectContaining({ callDataSize: 0 }))
  })

  // op-geth's pre-execution check is
  // `value + gasLimit * maxFeePerGas + l1Cost + operatorCost <= balance`. A max
  // send that leaves only the gas term behind therefore overdraws by exactly the
  // surcharge — the reported `insufficient funds for gas * price + value`, raised
  // after the keysign ceremony has already been paid for.
  it('leaves a max send affordable under the balance check the node actually runs', async () => {
    const balance = 12_437_685_400_530_920n
    const l1DataFee = 2_168_340_514n
    mocks.getOpStackFeeSurcharge.mockResolvedValue(l1DataFee)

    const payload = buildPayload({ chain: EvmChain.Optimism, gasLimit: 40_000n, maxFeePerGasWei: 1_500_000n })
    const gasTerm = 40_000n * 1_500_000n

    const maxSend = balance - (await feeAmount(payload))

    expect(maxSend + gasTerm + l1DataFee).toBeLessThanOrEqual(balance)
    expect(balance - (gasTerm + l1DataFee) - maxSend).toBe(0n)
  })
})
