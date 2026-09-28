import { EvmChain } from '@vultisig/core-chain/Chain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getErc20Allowance: vi.fn(),
  isErc20AllowanceResetRequired: vi.fn(),
}))

vi.mock('@vultisig/core-chain/chains/evm/erc20/getErc20Allowance', () => ({
  getErc20Allowance: mocks.getErc20Allowance,
}))

vi.mock('@vultisig/core-chain/chains/evm/erc20/isErc20AllowanceResetRequired', () => ({
  isErc20AllowanceResetRequired: mocks.isErc20AllowanceResetRequired,
}))

import { getErc20ApprovePayload } from './getErc20ApprovePayload'

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

describe('getErc20ApprovePayload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('needs no approval when the allowance already covers the amount', async () => {
    mocks.getErc20Allowance.mockResolvedValue(5_000_000n)

    await expect(getErc20ApprovePayload(input)).resolves.toBeUndefined()
    expect(mocks.isErc20AllowanceResetRequired).not.toHaveBeenCalled()
  })

  it('approves the exact amount without a reset when the allowance is zero', async () => {
    mocks.getErc20Allowance.mockResolvedValue(0n)

    const payload = await getErc20ApprovePayload(input)

    expect(payload).toMatchObject({ amount: '5000000', spender: SPENDER, resetAllowanceFirst: false })
    expect(mocks.isErc20AllowanceResetRequired).not.toHaveBeenCalled()
  })

  it('asks for the zero-first reset when a stale partial allowance makes the direct approve revert', async () => {
    mocks.getErc20Allowance.mockResolvedValue(1_000_000n)
    mocks.isErc20AllowanceResetRequired.mockResolvedValue(true)

    const payload = await getErc20ApprovePayload(input)

    expect(payload).toMatchObject({ amount: '5000000', spender: SPENDER, resetAllowanceFirst: true })
    expect(mocks.isErc20AllowanceResetRequired).toHaveBeenCalledWith(
      expect.objectContaining({ id: USDT, address: OWNER, spender: SPENDER, amount: 5_000_000n })
    )
  })

  it('keeps the single approve for tokens that accept a non-zero -> non-zero approve', async () => {
    mocks.getErc20Allowance.mockResolvedValue(1_000_000n)
    mocks.isErc20AllowanceResetRequired.mockResolvedValue(false)

    const payload = await getErc20ApprovePayload(input)

    expect(payload).toMatchObject({ amount: '5000000', resetAllowanceFirst: false })
  })
})
