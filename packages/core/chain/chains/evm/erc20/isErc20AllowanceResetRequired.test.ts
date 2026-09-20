import { EvmChain } from '@vultisig/core-chain/Chain'
import { createPublicClient, custom, encodeFunctionData, erc20Abi } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
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

const approveCalldata = encodeFunctionData({
  abi: erc20Abi,
  functionName: 'approve',
  args: [SPENDER, 5_000_000n],
})

// USDT's approve reverts without a reason string, which nodes report as a bare RPC error.
const executionReverted = () => Object.assign(new Error('execution reverted'), { code: 3 })

describe('isErc20AllowanceResetRequired', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // A real viem client over a stub transport, so the test exercises how the
    // eth_call result is read rather than a stand-in for it.
    mocks.getEvmClient.mockReturnValue(
      createPublicClient({ transport: custom({ request: mocks.request }, { retryCount: 0 }) })
    )
  })

  it('sends approve(spender, amount) as an eth_call from the owner address', async () => {
    mocks.request.mockResolvedValue('0x')

    await isErc20AllowanceResetRequired(input)

    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'eth_call',
        params: [expect.objectContaining({ from: OWNER, to: USDT, data: approveCalldata }), 'latest'],
      }),
      undefined
    )
  })

  it('answers false when the approve succeeds and returns true', async () => {
    mocks.request.mockResolvedValue(`0x${'1'.padStart(64, '0')}`)

    await expect(isErc20AllowanceResetRequired(input)).resolves.toBe(false)
  })

  it('answers false when the approve succeeds without return data, as USDT-style approve does', async () => {
    mocks.request.mockResolvedValue('0x')

    await expect(isErc20AllowanceResetRequired(input)).resolves.toBe(false)
  })

  it('answers true when the direct approve reverts, as USDT does on a non-zero -> non-zero approve', async () => {
    mocks.request.mockRejectedValue(executionReverted())

    await expect(isErc20AllowanceResetRequired(input)).resolves.toBe(true)
  })

  it('answers true when the node rejects the call for any other reason', async () => {
    mocks.request.mockRejectedValue(Object.assign(new Error('insufficient funds'), { code: -32000 }))

    await expect(isErc20AllowanceResetRequired(input)).resolves.toBe(true)
  })
})
