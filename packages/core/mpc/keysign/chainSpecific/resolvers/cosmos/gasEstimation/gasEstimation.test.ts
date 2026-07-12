import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Chain } from '@vultisig/core-chain/Chain'

import { scaleCosmosGasLimit } from './scaleCosmosGasLimit.js'

vi.mock('./buildSimulateTxBytes', () => ({
  buildSimulateTxBytes: vi.fn(),
}))
vi.mock('./simulateCosmosGas', () => ({
  simulateCosmosGas: vi.fn(),
}))

import { buildSimulateTxBytes } from './buildSimulateTxBytes.js'
import { simulateCosmosGas } from './simulateCosmosGas.js'
import { estimateCosmosGasLimit } from './estimateCosmosGasLimit.js'

const keysignPayload = {
  coin: {
    chain: Chain.Cosmos,
    address: 'cosmos1sender',
    hexPublicKey: '02'.padEnd(66, '0'),
    decimals: 6,
    ticker: 'ATOM',
  },
  toAddress: 'cosmos1recipient',
  toAmount: '100000',
  memo: '',
} as any

const walletCore = {} as any

describe('scaleCosmosGasLimit', () => {
  it('pads gas_used by 1.3x with ceiling (exact integer math)', () => {
    expect(scaleCosmosGasLimit(100_000n)).toBe(130_000n)
    // 100_001 * 1.3 = 130_001.3 -> ceil 130_002
    expect(scaleCosmosGasLimit(100_001n)).toBe(130_002n)
    expect(scaleCosmosGasLimit(1n)).toBe(2n)
    expect(scaleCosmosGasLimit(0n)).toBe(0n)
  })
})

describe('estimateCosmosGasLimit', () => {
  beforeEach(() => {
    vi.mocked(buildSimulateTxBytes).mockReset()
    vi.mocked(simulateCosmosGas).mockReset()
  })

  it('returns the padded gas limit when simulation succeeds', async () => {
    vi.mocked(buildSimulateTxBytes).mockReturnValue('dHhCeXRlcw==')
    vi.mocked(simulateCosmosGas).mockResolvedValue(90_000n)

    const result = await estimateCosmosGasLimit({
      walletCore,
      keysignPayload,
      accountNumber: 42n,
      sequence: 7n,
    })

    expect(result).toBe(117_000n) // ceil(90_000 * 1.3)
  })

  it('fails closed to undefined when the simulate call throws', async () => {
    vi.mocked(buildSimulateTxBytes).mockReturnValue('dHhCeXRlcw==')
    vi.mocked(simulateCosmosGas).mockRejectedValue(new Error('lcd down'))

    const result = await estimateCosmosGasLimit({
      walletCore,
      keysignPayload,
      accountNumber: 42n,
      sequence: 7n,
    })

    expect(result).toBeUndefined()
  })

  it('fails closed to undefined when building the tx bytes throws', async () => {
    vi.mocked(buildSimulateTxBytes).mockImplementation(() => {
      throw new Error('walletcore not ready')
    })

    const result = await estimateCosmosGasLimit({
      walletCore,
      keysignPayload,
      accountNumber: 42n,
      sequence: 7n,
    })

    expect(result).toBeUndefined()
    expect(simulateCosmosGas).not.toHaveBeenCalled()
  })
})
