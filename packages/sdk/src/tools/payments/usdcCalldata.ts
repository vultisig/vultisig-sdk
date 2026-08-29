import { getAddress } from 'viem'

import { encodeErc20Approve, MAX_UINT256 } from '../evm/encodeErc20Approve'

/**
 * Router version this SDK surface is pinned to. A checkout response returning
 * a different `router_version` must fail closed. Null is treated as v1 (legacy).
 */
export const ROUTER_VERSION_PINNED = 1

/**
 * Valid deposit_memo shape: `cp_` credit-pack or `sub_` subscription.
 * The body is at least 12 RFC 4648 base32 characters.
 */
export const DEPOSIT_MEMO_RE = /^(?:cp|sub)_[A-Z2-7]{12,}$/

/** Circle native USDC on checkout-supported chains. */
export const USDC_CONTRACTS = {
  Ethereum: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  Arbitrum: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  Base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
} as const

export type CheckoutUsdcChain = keyof typeof USDC_CONTRACTS

export const CHECKOUT_CHAIN_IDS: Record<CheckoutUsdcChain, number> = {
  Ethereum: 1,
  Arbitrum: 42161,
  Base: 8453,
}

/** Deterministic CREATE2 AgentRouter address, same on every checkout chain. */
export const AGENT_ROUTER_ADDRESS = '0xFEEEeeEE643d6AD9eBC6B2025a03eB2290A72bBf'

export const APPROVE_SELECTOR = '0x095ea7b3'
export const DEPOSIT_WITH_MEMO_SELECTOR = '0xd7c113a9'

export function resolveUsdcContract(chain: string): string {
  const addr = USDC_CONTRACTS[chain as CheckoutUsdcChain]
  if (!addr) {
    throw new Error(
      `usdcCalldata: chain "${chain}" is not supported for USDC checkout. Supported: ${Object.keys(USDC_CONTRACTS).join(', ')}`
    )
  }
  return addr
}

export function resolveCheckoutChainId(chain: string): number {
  const id = CHECKOUT_CHAIN_IDS[chain as CheckoutUsdcChain]
  if (!id) {
    throw new Error(
      `usdcCalldata: no chain ID for "${chain}". Supported: ${Object.keys(CHECKOUT_CHAIN_IDS).join(', ')}`
    )
  }
  return id
}

export function isValidDepositMemo(memo: string): boolean {
  return DEPOSIT_MEMO_RE.test(memo)
}

export function assertCheckoutRouterVersion(routerVersion: number | null | undefined): void {
  const version = routerVersion ?? 1
  if (version !== ROUTER_VERSION_PINNED) {
    throw new Error(
      `router_version_mismatch: checkout returned router_version ${version}, this SDK is pinned to ${ROUTER_VERSION_PINNED}`
    )
  }
}

export function buildApproveCalldata(spender: string, amount: bigint): `0x${string}` {
  return encodeErc20Approve(spender, amount)
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

function padHex(hex: string, byteLen: number): string {
  return hex.replace(/^0x/i, '').padStart(byteLen * 2, '0')
}

export function buildDepositWithMemoCalldata(token: string, amount: bigint, memo: string): `0x${string}` {
  if (!isValidDepositMemo(memo)) {
    throw new Error('usdcCalldata: invalid deposit memo')
  }
  if (amount < 0n || amount > MAX_UINT256) {
    throw new Error('usdcCalldata: deposit amount is outside uint256 range')
  }

  const selector = DEPOSIT_WITH_MEMO_SELECTOR.replace(/^0x/i, '')
  const paddedToken = padHex(getAddress(token), 32)
  const paddedAmount = padHex(amount.toString(16), 32)
  const paddedOffset = padHex((0x60).toString(16), 32)
  const memoBytes = new TextEncoder().encode(memo)
  const paddedMemoLen = padHex(memoBytes.length.toString(16), 32)
  const paddingNeeded = memoBytes.length % 32 === 0 ? 0 : 32 - (memoBytes.length % 32)
  const paddedMemoBytes = new Uint8Array(memoBytes.length + paddingNeeded)
  paddedMemoBytes.set(memoBytes)
  return `0x${selector}${paddedToken}${paddedAmount}${paddedOffset}${paddedMemoLen}${bytesToHex(paddedMemoBytes)}`
}

function decodeAddressWord(word32: string): string | null {
  if (!/^[0-9a-f]{64}$/i.test(word32)) return null
  if (!/^0{24}/.test(word32)) return null
  return `0x${word32.slice(24)}`
}

function decodeUintWord(word32: string): bigint | null {
  if (!/^[0-9a-f]{64}$/i.test(word32)) return null
  return BigInt(`0x${word32}`)
}

export type DecodedApproveParams = { spender: string; amount: bigint }
export type DecodedDepositWithMemoParams = { token: string; amount: bigint }

export function decodeApproveCalldata(data: string): DecodedApproveParams | null {
  const hex = data.replace(/^0x/i, '').toLowerCase()
  const selector = APPROVE_SELECTOR.replace(/^0x/i, '').toLowerCase()
  if (!hex.startsWith(selector)) return null
  if (hex.length < selector.length + 128) return null
  const spender = decodeAddressWord(hex.slice(selector.length, selector.length + 64))
  const amount = decodeUintWord(hex.slice(selector.length + 64, selector.length + 128))
  if (!spender || amount === null) return null
  return { spender, amount }
}

export function decodeDepositWithMemoCalldata(data: string): DecodedDepositWithMemoParams | null {
  const hex = data.replace(/^0x/i, '').toLowerCase()
  const selector = DEPOSIT_WITH_MEMO_SELECTOR.replace(/^0x/i, '').toLowerCase()
  if (!hex.startsWith(selector)) return null
  if (hex.length < selector.length + 128) return null
  const token = decodeAddressWord(hex.slice(selector.length, selector.length + 64))
  const amount = decodeUintWord(hex.slice(selector.length + 64, selector.length + 128))
  if (!token || amount === null) return null
  return { token, amount }
}
