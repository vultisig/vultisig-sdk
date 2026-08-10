import { EvmChain } from '@vultisig/core-chain/Chain'
import { size } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  readContract: vi.fn(),
  getEvmClient: vi.fn(),
}))

vi.mock('@vultisig/core-chain/chains/evm/client', () => ({
  getEvmClient: mocks.getEvmClient,
}))

import { getOpStackFeeSurcharge } from './getOpStackFeeSurcharge'

type OracleAnswers = {
  getL1Fee?: bigint | Error
  getOperatorFee?: bigint | Error
}

const answerWith = ({ getL1Fee = 0n, getOperatorFee = 0n }: OracleAnswers) => {
  mocks.readContract.mockImplementation(async ({ functionName }: { functionName: keyof OracleAnswers }) => {
    const answer = { getL1Fee, getOperatorFee }[functionName]
    if (answer instanceof Error) throw answer
    return answer
  })
}

const input = {
  chain: EvmChain.Optimism,
  gasLimit: 40_000n,
  callDataSize: 0,
} as const

describe('getOpStackFeeSurcharge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getEvmClient.mockReturnValue({ readContract: mocks.readContract })
  })

  it('sums the L1 data fee and the operator fee op-geth adds to its balance check', async () => {
    answerWith({ getL1Fee: 2_168_340_514n, getOperatorFee: 400_000_000_000_000n })

    expect(await getOpStackFeeSurcharge(input)).toBe(2_168_340_514n + 400_000_000_000_000n)
  })

  it('still reserves the L1 data fee when the oracle predates getOperatorFee', async () => {
    answerWith({ getL1Fee: 389_535_913n, getOperatorFee: new Error('execution reverted') })

    expect(await getOpStackFeeSurcharge(input)).toBe(389_535_913n)
  })

  it('still reserves the operator fee when the L1 lookup fails', async () => {
    answerWith({ getL1Fee: new Error('network down'), getOperatorFee: 900_000_000_000_000_000n })

    expect(await getOpStackFeeSurcharge(input)).toBe(900_000_000_000_000_000n)
  })

  it('reserves nothing when the oracle is unreachable, leaving the send exactly as it behaved before', async () => {
    answerWith({ getL1Fee: new Error('network down'), getOperatorFee: new Error('network down') })

    expect(await getOpStackFeeSurcharge(input)).toBe(0n)
  })

  it('floors a nonsensical negative answer instead of widening the spendable amount', async () => {
    answerWith({ getL1Fee: -1_000n, getOperatorFee: 500n })

    expect(await getOpStackFeeSurcharge(input)).toBe(500n)
  })

  it('skips the operator-fee lookup when there is no gas limit to price it against', async () => {
    answerWith({ getL1Fee: 1_000n })

    expect(await getOpStackFeeSurcharge({ ...input, gasLimit: 0n })).toBe(1_000n)
    expect(mocks.readContract).toHaveBeenCalledTimes(1)
    expect(mocks.readContract.mock.calls[0][0].functionName).toBe('getL1Fee')
  })

  it('prices the operator fee against the gas limit the node will hold, not the gas a transfer uses', async () => {
    answerWith({})

    await getOpStackFeeSurcharge({ ...input, chain: EvmChain.Mantle, gasLimit: 90_000_000n })

    const operatorCall = mocks.readContract.mock.calls.find(([{ functionName }]) => functionName === 'getOperatorFee')
    expect(operatorCall?.[0].args).toEqual([90_000_000n])
  })

  it('grows the priced payload with the transaction calldata', async () => {
    answerWith({})

    await getOpStackFeeSurcharge({ ...input, callDataSize: 0 })
    const withoutData = size(mocks.readContract.mock.calls[0][0].args[0])

    mocks.readContract.mockClear()
    await getOpStackFeeSurcharge({ ...input, callDataSize: 900 })
    const withData = size(mocks.readContract.mock.calls[0][0].args[0])

    expect(withData - withoutData).toBe(900)
    expect(withoutData).toBeGreaterThan(0)
  })
})
