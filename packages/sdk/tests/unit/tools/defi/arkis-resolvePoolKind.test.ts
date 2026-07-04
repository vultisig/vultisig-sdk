import { ContractFunctionExecutionError, ContractFunctionRevertedError, ContractFunctionZeroDataError } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockReadContract = vi.fn()

vi.mock('@vultisig/core-chain/chains/evm/client', () => ({
  getEvmClient: () => ({ readContract: mockReadContract }),
}))

import { resolveArkisPoolKind } from '@/tools/defi/arkis/resolvePoolKind'

const POOL = '0x1111111111111111111111111111111111111111'
const ASSET = '0xE0Cd4cAcDdcBF4f36e845407CE53E87717b6601d'

// Helper: viem wraps low-level errors in ContractFunctionExecutionError with a `.cause`.
const execWithCause = (cause: Error): ContractFunctionExecutionError => {
  const e = new ContractFunctionExecutionError(cause as ContractFunctionRevertedError, {
    abi: [],
    functionName: 'asset',
    args: [],
  })
  // Force the cause regardless of viem's internal normalization so the test pins
  // the EXACT classification logic resolveArkisPoolKind relies on.
  Object.defineProperty(e, 'cause', { value: cause, configurable: true })
  return e
}

describe('sdk.defi.arkis — resolveArkisPoolKind (fail-closed error classification)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('classifies a contract with a valid asset() as an erc4626_vault', async () => {
    mockReadContract.mockResolvedValueOnce(ASSET)
    const res = await resolveArkisPoolKind(POOL)
    expect(res.kind).toBe('erc4626_vault')
    expect(res.asset).toBe(ASSET)
  })

  it('treats a CONTRACT REVERT (no asset()) as a standard Agreement', async () => {
    const revert = new ContractFunctionRevertedError({ abi: [], functionName: 'asset', message: 'reverted' })
    mockReadContract.mockRejectedValueOnce(execWithCause(revert))
    const res = await resolveArkisPoolKind(POOL)
    expect(res.kind).toBe('agreement')
    expect(res.asset).toBeUndefined()
  })

  it('treats EMPTY-DATA (0x return, ZeroData) as a standard Agreement (regression: must NOT re-throw)', async () => {
    // WETH-class contracts return empty data for asset() rather than reverting.
    // Before the fix the narrowed guard re-threw this and BROKE agreement resolution.
    const zeroData = new ContractFunctionZeroDataError({ functionName: 'asset' })
    mockReadContract.mockRejectedValueOnce(execWithCause(zeroData))
    const res = await resolveArkisPoolKind(POOL)
    expect(res.kind).toBe('agreement')
  })

  it('RE-THROWS transport / RPC errors (timeout, rate-limit) — never silently mis-classifies', async () => {
    mockReadContract.mockRejectedValueOnce(new Error('HTTP request failed: 429 Too Many Requests'))
    await expect(resolveArkisPoolKind(POOL)).rejects.toThrow(/429/)
  })

  it('rejects a malformed pool address before any RPC call', async () => {
    await expect(resolveArkisPoolKind('not-an-address')).rejects.toThrow(/invalid/)
    expect(mockReadContract).not.toHaveBeenCalled()
  })
})
