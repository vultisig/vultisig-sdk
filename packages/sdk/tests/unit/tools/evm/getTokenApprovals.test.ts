import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockRequest = vi.fn()
const mockReadContract = vi.fn()
const mockGetBlockNumber = vi.fn()

vi.mock('@vultisig/core-chain/chains/evm/client', () => ({
  getEvmClient: () => ({
    request: mockRequest,
    readContract: mockReadContract,
    getBlockNumber: mockGetBlockNumber,
  }),
}))

import { getTokenApprovals } from '@/tools/evm/getTokenApprovals'

const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
const OWNER = '0x28c6c06298d514db089934071355e5743bf21d60'
const SPENDER_A = '0x1111111254eeb25477b68fb85ed929f73a960582'
const SPENDER_B = '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45'

// A raw eth_getLogs entry: topics[2] = indexed spender padded to 32 bytes.
const log = (address: string, spender: string) => ({
  address,
  topics: [
    '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925', // Approval sig
    `0x000000000000000000000000${OWNER.slice(2)}`,
    `0x000000000000000000000000${spender.slice(2)}`,
  ],
})

describe('getTokenApprovals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects an invalid owner address before hitting the network', async () => {
    await expect(getTokenApprovals('Ethereum', { owner: 'not-an-address' })).rejects.toThrow(/invalid owner address/)
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('returns empty when no Approval events exist', async () => {
    mockRequest.mockResolvedValueOnce([])
    const result = await getTokenApprovals('Ethereum', { owner: OWNER })
    expect(result.approvals).toEqual([])
    expect(result.totalCount).toBe(0)
    expect(mockReadContract).not.toHaveBeenCalled()
  })

  it('de-dupes (token, spender) pairs, drops zero/revoked allowances, and flags unlimited', async () => {
    // 3 events: USDC->A (unlimited), USDC->A duplicate, WETH->B (revoked to 0)
    mockRequest.mockResolvedValueOnce([log(USDC, SPENDER_A), log(USDC, SPENDER_A), log(WETH, SPENDER_B)])

    // Two unique pairs probed -> for each: allowance() then symbol()
    mockReadContract.mockImplementation(
      async ({ address, functionName }: { address: string; functionName: string }) => {
        const a = address.toLowerCase()
        if (functionName === 'allowance') {
          if (a === USDC) return 2n ** 200n // unlimited
          if (a === WETH) return 0n // revoked -> filtered out
        }
        if (functionName === 'symbol') {
          if (a === USDC) return 'USDC'
          if (a === WETH) return 'WETH'
        }
        return 0n
      }
    )

    const result = await getTokenApprovals('Ethereum', { owner: OWNER })

    expect(result.totalCount).toBe(1)
    expect(result.approvals).toHaveLength(1)
    const [approval] = result.approvals
    expect(approval.tokenSymbol).toBe('USDC')
    expect(approval.spenderAddress.toLowerCase()).toBe(SPENDER_A.toLowerCase())
    expect(approval.isUnlimited).toBe(true)
    // owner is checksummed in the result
    expect(result.address).toBe('0x28C6c06298d514Db089934071355E5743bf21d60')
  })

  it('retries over a bounded window when the RPC rejects an unbounded scan', async () => {
    mockRequest
      .mockRejectedValueOnce(new Error('query returned more than 10000 results, block range too large'))
      .mockResolvedValueOnce([log(USDC, SPENDER_A)])
    mockGetBlockNumber.mockResolvedValueOnce(50_000n)
    mockReadContract.mockImplementation(async ({ functionName }: { functionName: string }) =>
      functionName === 'allowance' ? 1_000_000n : 'USDC'
    )

    const result = await getTokenApprovals('Ethereum', { owner: OWNER })

    expect(mockRequest).toHaveBeenCalledTimes(2)
    expect(mockGetBlockNumber).toHaveBeenCalledTimes(1)
    // second call used a bounded fromBlock (latest - 10_000 = 40_000 -> 0x9c40)
    expect(mockRequest.mock.calls[1][0].params[0].fromBlock).toBe('0x9c40')
    expect(result.totalCount).toBe(1)
    expect(result.approvals[0].allowance).toBe(1_000_000n)
    expect(result.approvals[0].isUnlimited).toBe(false)
  })

  // Pin the exact `unlimited` boundary. The threshold (2^128) is the
  // security-relevant constant a wallet leans on to surface "unlimited" risk —
  // a regression flipping >= to > or swapping 2^128 for 2^256 must fail here.
  it.each([
    { label: '2^128 - 1 (just below)', allowance: 2n ** 128n - 1n, expected: false },
    { label: '2^128 (boundary, inclusive)', allowance: 2n ** 128n, expected: true },
    { label: '2^128 + 1 (just above)', allowance: 2n ** 128n + 1n, expected: true },
    { label: 'MaxUint256 (2^256 - 1)', allowance: 2n ** 256n - 1n, expected: true },
  ])('flags isUnlimited=$expected at $label', async ({ allowance, expected }) => {
    mockRequest.mockResolvedValueOnce([log(USDC, SPENDER_A)])
    mockReadContract.mockImplementation(async ({ functionName }: { functionName: string }) =>
      functionName === 'allowance' ? allowance : 'USDC'
    )

    const result = await getTokenApprovals('Ethereum', { owner: OWNER })

    expect(result.totalCount).toBe(1)
    expect(result.approvals[0].allowance).toBe(allowance)
    expect(result.approvals[0].isUnlimited).toBe(expected)
  })
})
