import { encodeFunctionData, erc20Abi, keccak256, toBytes } from 'viem'
import { describe, expect, it } from 'vitest'

import {
  AGENT_ROUTER_ADDRESS,
  assertCheckoutRouterVersion,
  buildApproveCalldata,
  buildDepositWithMemoCalldata,
  decodeApproveCalldata,
  decodeDepositWithMemoCalldata,
  DEPOSIT_WITH_MEMO_SELECTOR,
  isValidDepositMemo,
  resolveCheckoutChainId,
  resolveUsdcContract,
  ROUTER_VERSION_PINNED,
  USDC_CONTRACTS,
} from '@/tools/payments/usdcCalldata'

const SPENDER = '0xFEEEeeEE643d6AD9eBC6B2025a03eB2290A72bBf'
const TOKEN = USDC_CONTRACTS.Ethereum

describe('usdcCalldata', () => {
  it('resolves Circle USDC + chain ids for the checkout set and fails closed otherwise', () => {
    expect(resolveUsdcContract('Ethereum')).toBe(TOKEN)
    expect(resolveCheckoutChainId('Base')).toBe(8453)
    expect(() => resolveUsdcContract('Bitcoin')).toThrow(/not supported/)
    expect(() => resolveCheckoutChainId('Solana')).toThrow(/no chain ID/)
  })

  it('accepts cp_/sub_ memos and rejects anything else', () => {
    expect(isValidDepositMemo('cp_AB23CD45EF67')).toBe(true)
    expect(isValidDepositMemo('sub_ZZZZ2222AAAA')).toBe(true)
    expect(isValidDepositMemo('Cp_AB23CD45EF67')).toBe(false)
    expect(isValidDepositMemo('pack_AB23CD45EF67')).toBe(false)
    expect(isValidDepositMemo('cp_AB23CD45EF6')).toBe(false)
    expect(isValidDepositMemo('cp_AB23CD45EF60')).toBe(false)
  })

  it('pins router v1 and treats a missing version as v1; any other version fails closed', () => {
    expect(ROUTER_VERSION_PINNED).toBe(1)
    expect(() => assertCheckoutRouterVersion(undefined)).not.toThrow()
    expect(() => assertCheckoutRouterVersion(null)).not.toThrow()
    expect(() => assertCheckoutRouterVersion(1)).not.toThrow()
    expect(() => assertCheckoutRouterVersion(2)).toThrow(/router_version_mismatch/)
  })

  it('builds approve calldata that matches viem and decodes back', () => {
    const encoded = buildApproveCalldata(SPENDER, 1_000_000n)
    expect(encoded).toBe(
      encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [SPENDER, 1_000_000n],
      })
    )
    expect(decodeApproveCalldata(encoded)).toEqual({ spender: SPENDER.toLowerCase(), amount: 1_000_000n })
    expect(decodeApproveCalldata('0xdeadbeef')).toBeNull()
  })

  it('pins the depositWithMemo selector to keccak256 of the canonical signature', () => {
    expect(DEPOSIT_WITH_MEMO_SELECTOR).toBe(keccak256(toBytes('depositWithMemo(address,uint256,bytes)')).slice(0, 10))
  })

  it('round-trips depositWithMemo token + amount and does not fall back on a bad selector', () => {
    const data = buildDepositWithMemoCalldata(TOKEN, 5_000_000n, 'cp_AB23CD45EF67')
    expect(data.startsWith(DEPOSIT_WITH_MEMO_SELECTOR)).toBe(true)
    expect(decodeDepositWithMemoCalldata(data)).toEqual({
      token: TOKEN.toLowerCase(),
      amount: 5_000_000n,
    })
    expect(decodeDepositWithMemoCalldata(buildApproveCalldata(SPENDER, 1n))).toBeNull()
  })

  it('rejects invalid deposit memos before encoding', () => {
    expect(() => buildDepositWithMemoCalldata(TOKEN, 1n, 'cp_AB23CD45EF6')).toThrow(/invalid deposit memo/)
    expect(() => buildDepositWithMemoCalldata(TOKEN, 1n, 'sub_AB23CD45EF60')).toThrow(/invalid deposit memo/)
  })

  it('accepts uint256 amount bounds and rejects values outside them', () => {
    const maxUint256 = (1n << 256n) - 1n

    expect(decodeDepositWithMemoCalldata(buildDepositWithMemoCalldata(TOKEN, 0n, 'cp_AB23CD45EF67'))?.amount).toBe(0n)
    expect(
      decodeDepositWithMemoCalldata(buildDepositWithMemoCalldata(TOKEN, maxUint256, 'cp_AB23CD45EF67'))?.amount
    ).toBe(maxUint256)
    expect(() => buildDepositWithMemoCalldata(TOKEN, -1n, 'cp_AB23CD45EF67')).toThrow(/uint256 range/)
    expect(() => buildDepositWithMemoCalldata(TOKEN, maxUint256 + 1n, 'cp_AB23CD45EF67')).toThrow(/uint256 range/)
  })

  it('exposes the CREATE2 AgentRouter address', () => {
    expect(AGENT_ROUTER_ADDRESS).toBe('0xFEEEeeEE643d6AD9eBC6B2025a03eB2290A72bBf')
  })
})
