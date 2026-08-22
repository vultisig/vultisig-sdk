import { EvmChain } from '@vultisig/core-chain/Chain'
import { decodeFunctionData, erc20Abi, getAddress } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import { MAX_UINT256 } from '@/tools/evm/encodeErc20Approve'
import {
  buildErc20ApprovalTx,
  DEFAULT_MAX_APPROVAL_TO_BALANCE_RATIO,
  parseErc20ApprovalAmount,
} from '@/tools/evm/erc20ApprovalTx'

const TOKEN = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
const SPENDER = '0x1111111254eeb25477b68fb85ed929f73a960582'
const OWNER = '0x000000000000000000000000000000000000dead'

const codeOk = () => vi.fn(async () => true)
const decimals = (value: number) => vi.fn(async () => value)
const balance = (value: bigint) => vi.fn(async () => value)

describe('parseErc20ApprovalAmount', () => {
  it('normalizes max without requiring decimals', () => {
    expect(parseErc20ApprovalAmount({ amount: ' max ' })).toEqual({
      amountBaseUnits: MAX_UINT256,
      amountMode: 'max',
      amountIsBaseUnits: false,
    })
  })

  it('normalizes revoke without requiring decimals', () => {
    expect(parseErc20ApprovalAmount({ amount: '0' })).toEqual({
      amountBaseUnits: 0n,
      amountMode: 'revoke',
      amountIsBaseUnits: false,
    })
  })

  it('scales human-readable amounts to base units and truncates extra precision', () => {
    expect(parseErc20ApprovalAmount({ amount: '100.1234567', decimals: 6 })).toEqual({
      amountBaseUnits: 100123456n,
      amountMode: 'specific',
      amountIsBaseUnits: false,
      decimals: 6,
    })
  })

  it('uses strict plain decimal integers for base-unit amounts', () => {
    expect(parseErc20ApprovalAmount({ amount: '5000000', amountIsBaseUnits: true }).amountBaseUnits).toBe(5000000n)
    expect(() => parseErc20ApprovalAmount({ amount: '5.0', amountIsBaseUnits: true })).toThrow(
      /plain non-negative integer/
    )
    expect(() => parseErc20ApprovalAmount({ amount: '0x5', amountIsBaseUnits: true })).toThrow(
      /plain non-negative integer/
    )
    expect(() => parseErc20ApprovalAmount({ amount: '+5', amountIsBaseUnits: true })).toThrow(
      /plain non-negative integer/
    )
  })

  it('requires decimals for human-readable specific amounts', () => {
    expect(() => parseErc20ApprovalAmount({ amount: '1.2' })).toThrow(/decimals are required/)
  })
})

describe('buildErc20ApprovalTx', () => {
  it('builds a backend-compatible approval envelope plus normalized metadata', async () => {
    const hasCode = codeOk()
    const readDecimals = decimals(6)
    const readBalance = balance(10_000000n)

    const result = await buildErc20ApprovalTx({
      chain: EvmChain.Base,
      contractAddress: TOKEN,
      spender: SPENDER,
      amount: '1.5',
      from: OWNER,
      validation: { hooks: { hasCode, readDecimals, readBalance } },
    })

    expect(result.tx).toMatchObject({
      chain: EvmChain.Base,
      chain_id: '8453',
      to: getAddress(TOKEN),
      value: '0',
      spender: getAddress(SPENDER),
      amount: '1500000',
      is_unlimited: false,
    })

    const decoded = decodeFunctionData({ abi: erc20Abi, data: result.tx.data })
    expect(decoded.functionName).toBe('approve')
    expect(decoded.args).toEqual([getAddress(SPENDER), 1500000n])

    expect(result.approval).toEqual({
      chain: EvmChain.Base,
      chainId: '8453',
      tokenAddress: getAddress(TOKEN),
      spender: getAddress(SPENDER),
      amountBaseUnits: 1500000n,
      amount: '1500000',
      amountMode: 'specific',
      amountIsBaseUnits: false,
      decimals: 6,
      isUnlimited: false,
      isRevoke: false,
    })
    expect(hasCode).toHaveBeenCalledWith({ chain: EvmChain.Base, address: getAddress(TOKEN), role: 'token' })
    expect(hasCode).toHaveBeenCalledWith({ chain: EvmChain.Base, address: getAddress(SPENDER), role: 'spender' })
    expect(readDecimals).toHaveBeenCalledWith({ chain: EvmChain.Base, tokenAddress: getAddress(TOKEN) })
    expect(readBalance).toHaveBeenCalledWith({
      chain: EvmChain.Base,
      tokenAddress: getAddress(TOKEN),
      owner: getAddress(OWNER),
    })
  })

  it('builds base-unit approvals without fetching decimals', async () => {
    const readDecimals = decimals(6)

    const result = await buildErc20ApprovalTx({
      chain: EvmChain.Ethereum,
      contractAddress: TOKEN,
      spender: SPENDER,
      amount: '5000000',
      amountIsBaseUnits: true,
      validation: { hooks: { hasCode: codeOk(), readDecimals, readBalance: balance(100_000000n) } },
    })

    expect(result.tx.chain_id).toBe('1')
    expect(result.tx.amount).toBe('5000000')
    expect(result.approval.amountIsBaseUnits).toBe(true)
    expect(result.approval.decimals).toBeUndefined()
    expect(readDecimals).not.toHaveBeenCalled()
  })

  it('keeps max and revoke on their dedicated paths', async () => {
    const hasCode = codeOk()
    const readDecimals = decimals(6)
    const readBalance = balance(1n)

    const unlimited = await buildErc20ApprovalTx({
      chain: EvmChain.Ethereum,
      contractAddress: TOKEN,
      spender: SPENDER,
      amount: 'max',
      validation: { hooks: { hasCode, readDecimals, readBalance } },
    })
    expect(unlimited.tx.amount).toBe(MAX_UINT256.toString())
    expect(unlimited.tx.is_unlimited).toBe(true)
    expect(unlimited.approval.amountMode).toBe('max')

    hasCode.mockClear()
    const revoke = await buildErc20ApprovalTx({
      chain: EvmChain.Ethereum,
      contractAddress: TOKEN,
      spender: SPENDER,
      amount: '0',
      validation: { hooks: { hasCode, readDecimals, readBalance } },
    })
    expect(revoke.tx.amount).toBe('0')
    expect(revoke.approval.amountMode).toBe('revoke')
    expect(hasCode).toHaveBeenCalledTimes(1)
    expect(hasCode).toHaveBeenCalledWith({ chain: EvmChain.Ethereum, address: getAddress(TOKEN), role: 'token' })
    expect(readDecimals).not.toHaveBeenCalled()
    expect(readBalance).not.toHaveBeenCalled()
  })

  it('rejects token and spender addresses with no bytecode', async () => {
    await expect(
      buildErc20ApprovalTx({
        chain: EvmChain.Ethereum,
        contractAddress: TOKEN,
        spender: SPENDER,
        amount: '1',
        validation: { hooks: { hasCode: vi.fn(async ({ role }) => role !== 'token') } },
      })
    ).rejects.toThrow(/token .* has no code/)

    await expect(
      buildErc20ApprovalTx({
        chain: EvmChain.Ethereum,
        contractAddress: TOKEN,
        spender: SPENDER,
        amount: '1',
        validation: { hooks: { hasCode: vi.fn(async ({ role }) => role !== 'spender'), readDecimals: decimals(6) } },
      })
    ).rejects.toThrow(/spender .* has no code/)
  })

  it('bounds specific approvals against the signer balance when owner or from is available', async () => {
    await expect(
      buildErc20ApprovalTx({
        chain: EvmChain.Ethereum,
        contractAddress: TOKEN,
        spender: SPENDER,
        amount: '1001',
        from: OWNER,
        validation: {
          hooks: {
            hasCode: codeOk(),
            readDecimals: decimals(0),
            readBalance: balance(10n),
          },
        },
      })
    ).rejects.toThrow(
      new RegExp(`exceeds ${DEFAULT_MAX_APPROVAL_TO_BALANCE_RATIO.toString()}x the owner's current balance`)
    )
  })

  it('supports explicit fail-open compatibility for transient code and balance reads', async () => {
    const result = await buildErc20ApprovalTx({
      chain: EvmChain.Ethereum,
      contractAddress: TOKEN,
      spender: SPENDER,
      amount: '1',
      from: OWNER,
      validation: {
        failOpenOnCodeCheckError: true,
        failOpenOnBalanceCheckError: true,
        hooks: {
          hasCode: vi.fn(async () => {
            throw new Error('rpc unavailable')
          }),
          readDecimals: decimals(6),
          readBalance: vi.fn(async () => {
            throw new Error('balance rpc unavailable')
          }),
        },
      },
    })

    expect(result.tx.amount).toBe('1000000')
  })

  it('does not fail open on confirmed no-code addresses', async () => {
    await expect(
      buildErc20ApprovalTx({
        chain: EvmChain.Ethereum,
        contractAddress: TOKEN,
        spender: SPENDER,
        amount: '0',
        validation: {
          failOpenOnCodeCheckError: true,
          hooks: { hasCode: vi.fn(async () => false) },
        },
      })
    ).rejects.toThrow(/token .* has no code/)
  })
})
