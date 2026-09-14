import { encodeFunctionData, stringToHex } from 'viem'
import { describe, expect, it } from 'vitest'

import {
  AGENT_ROUTER_ADDRESS,
  AGENT_ROUTER_DEPOSIT_WITH_MEMO_SELECTOR,
  CHECKOUT_CHAIN_IDS,
  decodeAgentRouterDepositWithMemo,
  encodeAgentRouterDepositWithMemo,
  encodeErc20Approve,
  formatCheckoutUsdcDisplay,
  isUsdcPaymentChain,
  lookupUsdcPaymentChain,
  resolveUsdcPaymentChainId,
  resolveUsdcPaymentContract,
  USDC_CONTRACTS,
  USDC_PAYMENT_CHAINS,
} from '@/tools/evm'

// architecture#1949 — AgentRouter / USDC checkout canonicals, ported from
// vultiagent-app's + agent-backend-ts's independently-drifting copies. Fund
// safety: this is calldata a user signs to top up credits / renew Pro, so
// every encoder is pinned against viem's own `encodeFunctionData` (the
// canonical oracle), not just self-consistency.

const AGENT_ROUTER = AGENT_ROUTER_ADDRESS.toLowerCase()
const USDC_ETH = USDC_CONTRACTS.Ethereum.toLowerCase()
const AMOUNT = 5_000_000n // 5 USDC (6 decimals)

const depositWithMemoAbi = [
  {
    type: 'function',
    name: 'depositWithMemo',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'memo', type: 'bytes' },
    ],
    outputs: [],
  },
] as const

describe('USDC payment-chain registry', () => {
  it('pins the checkout router address, native USDC contracts, and chain IDs', () => {
    expect(AGENT_ROUTER_ADDRESS).toBe('0xFEEEeeEE643d6AD9eBC6B2025a03eB2290A72bBf')
    expect(USDC_CONTRACTS.Ethereum.toLowerCase()).toBe('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')
    expect(USDC_CONTRACTS.Arbitrum.toLowerCase()).toBe('0xaf88d065e77c8cc2239327c5edb3a432268e5831')
    expect(USDC_CONTRACTS.Base.toLowerCase()).toBe('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913')
    expect(CHECKOUT_CHAIN_IDS).toEqual({ Ethereum: 1, Arbitrum: 42161, Base: 8453 })
    expect(USDC_PAYMENT_CHAINS).toEqual(['Ethereum', 'Arbitrum', 'Base'])
  })

  it('isUsdcPaymentChain / lookupUsdcPaymentChain agree on supported vs unsupported chains', () => {
    expect(isUsdcPaymentChain('Ethereum')).toBe(true)
    expect(isUsdcPaymentChain('Solana')).toBe(false)
    expect(lookupUsdcPaymentChain('Base')).toEqual({
      scannerChain: 'base',
      chainId: 8453,
      contract: USDC_CONTRACTS.Base,
    })
    expect(lookupUsdcPaymentChain('Solana')).toBeUndefined()
  })

  it('resolveUsdcPaymentContract / resolveUsdcPaymentChainId throw on an unsupported chain', () => {
    expect(resolveUsdcPaymentContract('Arbitrum')).toBe(USDC_CONTRACTS.Arbitrum)
    expect(resolveUsdcPaymentChainId('Arbitrum')).toBe(42161)
    expect(() => resolveUsdcPaymentContract('Solana')).toThrow(/not supported for USDC checkout/)
    expect(() => resolveUsdcPaymentChainId('Solana')).toThrow(/no chain ID/)
  })
})

describe('encodeAgentRouterDepositWithMemo', () => {
  it('canonical 4-byte selector', () => {
    // Independent confirmation the constant matches keccak256(signature)[0:4].
    expect(AGENT_ROUTER_DEPOSIT_WITH_MEMO_SELECTOR).toBe('0xd7c113a9')
  })

  it('matches viem depositWithMemo(address,uint256,bytes) encoding', () => {
    const memo = 'cp_ABCDEF123456'
    const got = encodeAgentRouterDepositWithMemo(USDC_ETH, AMOUNT, memo).toLowerCase()
    const want = encodeFunctionData({
      abi: depositWithMemoAbi,
      functionName: 'depositWithMemo',
      args: [USDC_ETH as `0x${string}`, AMOUNT, stringToHex(memo)],
    }).toLowerCase()
    expect(got).toBe(want)
    expect(got.slice(0, 10)).toBe(AGENT_ROUTER_DEPOSIT_WITH_MEMO_SELECTOR)
  })

  it('handles an exactly-32-byte memo (no stray right-padding)', () => {
    const memo = 'x'.repeat(32)
    const got = encodeAgentRouterDepositWithMemo(USDC_ETH, AMOUNT, memo).toLowerCase()
    const want = encodeFunctionData({
      abi: depositWithMemoAbi,
      functionName: 'depositWithMemo',
      args: [USDC_ETH as `0x${string}`, AMOUNT, stringToHex(memo)],
    }).toLowerCase()
    expect(got).toBe(want)
  })

  it('handles an empty memo', () => {
    const got = encodeAgentRouterDepositWithMemo(USDC_ETH, AMOUNT, '').toLowerCase()
    const want = encodeFunctionData({
      abi: depositWithMemoAbi,
      functionName: 'depositWithMemo',
      args: [USDC_ETH as `0x${string}`, AMOUNT, '0x'],
    }).toLowerCase()
    expect(got).toBe(want)
  })

  it('normalizes a lowercased token address to its EIP-55 checksum form', () => {
    const fromLower = encodeAgentRouterDepositWithMemo(USDC_ETH, AMOUNT, 'm')
    const fromUpper = encodeAgentRouterDepositWithMemo(USDC_ETH.toUpperCase().replace('0X', '0x'), AMOUNT, 'm')
    expect(fromLower).toBe(fromUpper)
  })
})

describe('decodeAgentRouterDepositWithMemo', () => {
  it('round-trips token, amount, AND the memo (both prior copies only decoded the head)', () => {
    const memo = 'cp_ABCDEF123456'
    const calldata = encodeAgentRouterDepositWithMemo(USDC_ETH, AMOUNT, memo)
    const decoded = decodeAgentRouterDepositWithMemo(calldata)
    expect(decoded).not.toBeNull()
    expect(decoded!.token.toLowerCase()).toBe(USDC_ETH)
    expect(decoded!.amount).toBe(AMOUNT)
    expect(decoded!.memo).toBe(memo)
  })

  it('round-trips a multi-byte UTF-8 memo', () => {
    const memo = 'cp_ünïcödé_🎉'
    const calldata = encodeAgentRouterDepositWithMemo(USDC_ETH, AMOUNT, memo)
    expect(decodeAgentRouterDepositWithMemo(calldata)!.memo).toBe(memo)
  })

  it('accepts calldata without a leading 0x', () => {
    const calldata = encodeAgentRouterDepositWithMemo(USDC_ETH, AMOUNT, 'cp_test').slice(2)
    expect(decodeAgentRouterDepositWithMemo(calldata)!.memo).toBe('cp_test')
  })

  it('fails closed (null) on a selector mismatch (e.g. an approve calldata)', () => {
    const approveCalldata = encodeErc20Approve(AGENT_ROUTER, AMOUNT)
    expect(decodeAgentRouterDepositWithMemo(approveCalldata)).toBeNull()
  })

  it('fails closed (null) on truncated calldata (selector-only, no params)', () => {
    expect(decodeAgentRouterDepositWithMemo(AGENT_ROUTER_DEPOSIT_WITH_MEMO_SELECTOR)).toBeNull()
  })

  it('fails closed (null) on garbage bytes', () => {
    expect(decodeAgentRouterDepositWithMemo('0xdeadbeef')).toBeNull()
  })

  it('fails closed (null) when the ABI memo bytes are not valid UTF-8', () => {
    const calldata = encodeFunctionData({
      abi: depositWithMemoAbi,
      functionName: 'depositWithMemo',
      args: [USDC_ETH as `0x${string}`, AMOUNT, '0xff'],
    })
    expect(decodeAgentRouterDepositWithMemo(calldata)).toBeNull()
  })
})

describe('formatCheckoutUsdcDisplay', () => {
  it('rounds to the nearest cent (half-away-from-zero) — the exact contract app#2528 needed', () => {
    expect(formatCheckoutUsdcDisplay(1_234_560)).toBe('1.23') // 1.23456 -> 1.23
    expect(formatCheckoutUsdcDisplay(1_235_000)).toBe('1.24') // 1.235   -> 1.24 (half-up)
    expect(formatCheckoutUsdcDisplay(-1_235_000)).toBe('-1.24') // -1.235 -> -1.24
    expect(formatCheckoutUsdcDisplay(1_995_000)).toBe('2.00') // 1.995   -> 2.00 (carry)
    expect(formatCheckoutUsdcDisplay(0)).toBe('0.00')
    expect(formatCheckoutUsdcDisplay(20_000_000)).toBe('20.00')
  })

  it.each([NaN, Infinity, -Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.MIN_SAFE_INTEGER - 1])(
    'rejects non-safe-integer microdollar input %s',
    microdollars => {
      expect(() => formatCheckoutUsdcDisplay(microdollars)).toThrow('microdollars must be a safe integer')
    }
  )
})
