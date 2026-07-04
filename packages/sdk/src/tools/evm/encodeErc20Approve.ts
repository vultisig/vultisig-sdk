import { encodeFunctionData, erc20Abi, getAddress } from 'viem'

type EncodeResult = `0x${string}`

/** uint256 max — the canonical "unlimited approval" amount. */
export const MAX_UINT256 = (1n << 256n) - 1n

/**
 * ABI-encode `approve(spender, amount)` calldata for any ERC-20 token.
 *
 * Pure calldata encode — no RPC, no chain client, no decimals() lookup. The
 * caller is responsible for passing `amount` already in base units (raw
 * integer). Use {@link MAX_UINT256} for an unlimited approval.
 *
 * `spender` is normalized to its EIP-55 checksum form so the same logical
 * approval always produces byte-identical calldata regardless of input
 * casing (mirrors the mcp-ts `erc20_approve` tool + the Go MCP side).
 *
 * @example
 * ```ts
 * // Unlimited approval to a DEX router
 * encodeErc20Approve('0x1111111254EEB25477B68fb85Ed929f73A960582', MAX_UINT256)
 * // => '0x095ea7b3...'  (approve selector)
 * ```
 *
 * @param spender Address being granted the allowance (e.g. DEX router).
 * @param amount  Allowance in base units. Throws if outside the uint256 range.
 * @returns 0x-prefixed `approve(spender,amount)` calldata.
 */
export const encodeErc20Approve = (spender: string, amount: bigint): EncodeResult => {
  if (amount < 0n) {
    throw new Error(`approve amount must be non-negative: ${amount.toString()}`)
  }
  if (amount > MAX_UINT256) {
    throw new Error(`approve amount out of uint256 range: ${amount.toString()} exceeds MAX_UINT256`)
  }

  return encodeFunctionData({
    abi: erc20Abi,
    functionName: 'approve',
    args: [getAddress(spender), amount],
  })
}

/**
 * ABI-encode `approve(spender, 0)` calldata — the ERC-20 standard pattern for
 * revoking a stale or risky allowance.
 *
 * Always passes `0n`, so (unlike a decimals-aware approve) it works on
 * non-standard tokens that don't implement `decimals()` — exactly the
 * category of tokens whose unlimited approvals you most urgently want to
 * revoke. Pure calldata encode, no RPC.
 *
 * @example
 * ```ts
 * encodeErc20Revoke('0x1111111254EEB25477B68fb85Ed929f73A960582')
 * // => '0x095ea7b3...0000'  (approve selector, amount 0)
 * ```
 *
 * @param spender Address whose allowance to revoke.
 * @returns 0x-prefixed `approve(spender,0)` calldata.
 */
export const encodeErc20Revoke = (spender: string): EncodeResult => encodeErc20Approve(spender, 0n)
