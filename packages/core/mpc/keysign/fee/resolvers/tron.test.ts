import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getTrc20TransferFeeAmount } from '../../chainSpecific/resolvers/tron/fee'
import { getTronFeeAmount } from './tron'

vi.mock('../../chainSpecific/resolvers/tron/fee', () => ({ getTrc20TransferFeeAmount: vi.fn() }))

const fromAddress = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb'
const buildPayload = (isNativeToken: boolean, gasEstimation = 42_000_000n) =>
  create(KeysignPayloadSchema, {
    coin: { chain: Chain.Tron, address: fromAddress, isNativeToken },
    blockchainSpecific: { case: 'tronSpecific', value: { gasEstimation } },
  })

// The resolver does not consume walletCore or publicKey for either Tron branch.
const feeAmount = (keysignPayload: ReturnType<typeof buildPayload>) => getTronFeeAmount({ keysignPayload } as never)

describe('getTronFeeAmount', () => {
  beforeEach(() => vi.resetAllMocks())

  it.each([0n, 42_000_000n, 9_007_199_254_740_993n])(
    'returns native gasEstimation %s exactly without querying token fees',
    async gasEstimation => {
      await expect(feeAmount(buildPayload(true, gasEstimation))).resolves.toBe(gasEstimation)
      expect(getTrc20TransferFeeAmount).not.toHaveBeenCalled()
    }
  )

  it.each([0n, 42_000_000n])('delegates a token fee limit of %s with the sender address', async feeLimit => {
    vi.mocked(getTrc20TransferFeeAmount).mockResolvedValue(1_234_567n)
    await expect(feeAmount(buildPayload(false, feeLimit))).resolves.toBe(1_234_567n)
    expect(getTrc20TransferFeeAmount).toHaveBeenCalledExactlyOnceWith({ feeLimit, fromAddress })
  })

  it('propagates token fee calculation failures', async () => {
    const error = new Error('energy query failed')
    vi.mocked(getTrc20TransferFeeAmount).mockRejectedValue(error)
    await expect(feeAmount(buildPayload(false))).rejects.toBe(error)
  })

  it('rejects missing coin metadata', async () => {
    const payload = buildPayload(true)
    payload.coin = undefined
    await expect(feeAmount(payload)).rejects.toThrow()
    expect(getTrc20TransferFeeAmount).not.toHaveBeenCalled()
  })

  it('rejects absent chain-specific data', async () => {
    const payload = buildPayload(true)
    payload.blockchainSpecific = { case: undefined }
    await expect(feeAmount(payload)).rejects.toThrow('Invalid blockchain specific')
  })
})
