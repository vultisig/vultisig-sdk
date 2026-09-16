import { EvmChain } from '@vultisig/core-chain/Chain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  simulateContract: vi.fn(),
  getEvmClient: vi.fn(),
}))

vi.mock('@vultisig/core-chain/chains/evm/client', () => ({
  getEvmClient: mocks.getEvmClient,
}))

import { isErc20AllowanceResetRequired } from './isErc20AllowanceResetRequired'

const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7'
const OWNER = '0x1234567890123456789012345678901234567890'
const SPENDER = '0x111111125421ca6dc452d289314280a0f8842a65'

const input = {
  chain: EvmChain.Ethereum,
  id: USDT,
  address: OWNER,
  spender: SPENDER,
  amount: 5_000_000n,
}

describe('isErc20AllowanceResetRequired', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getEvmClient.mockReturnValue({ simulateContract: mocks.simulateContract })
  })

  it('simulates approve(spender, amount) from the owner address', async () => {
    mocks.simulateContract.mockResolvedValue({ result: true })

    await isErc20AllowanceResetRequired(input)

    expect(mocks.simulateContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: USDT,
        functionName: 'approve',
        args: [SPENDER, 5_000_000n],
        account: OWNER,
      })
    )
  })

  it('answers false when the direct approve would succeed', async () => {
    mocks.simulateContract.mockResolvedValue({ result: true })

    await expect(isErc20AllowanceResetRequired(input)).resolves.toBe(false)
  })

  it('answers true when the direct approve reverts, as USDT does on a non-zero -> non-zero approve', async () => {
    mocks.simulateContract.mockRejectedValue(new Error('execution reverted'))

    await expect(isErc20AllowanceResetRequired(input)).resolves.toBe(true)
  })
})
