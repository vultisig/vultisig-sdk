/**
 * Token-transfer / ERC-20-calldata destination safety helpers
 * (architecture#1774).
 *
 * Ported from `agent-backend-ts`'s local fork
 * (`src/mastra/tools/mcp/lib/dangerous-addresses.ts`), which the SDK didn't
 * publish a canonical for — the SDK only exposed `assertSafeDestination`
 * (burn/dead addresses) and had a narrower, inline own-token-contract check
 * duplicated in `tools/prep/send.ts`. This is a sibling guard: rejecting a
 * transfer whose RECIPIENT is itself a known token contract (not just a
 * generic burn address), plus the calldata decoders needed to find that
 * recipient when it's hidden inside an ERC-20 `transfer`/`transferFrom`
 * call rather than a plain send.
 *
 * Lives in `core-chain` (not the SDK) so it can be imported by both SDK
 * build-tx primitives and any lower-level core-chain guard — mirrors
 * `dangerousAddresses.ts`'s own placement rationale.
 */
import { Chain } from '@vultisig/core-chain/Chain'
import { knownTokensIndex } from '@vultisig/core-chain/coin/knownTokens'

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

/**
 * Throws when a plain token-transfer `recipient` is itself a known token
 * contract address on `chain` — most commonly the SAME token being sent to
 * its own contract, but also catches a transfer aimed at a different known
 * token's contract.
 *
 * Call this ONLY on plain-transfer recipients (a native/ERC-20 send, or a
 * decoded ERC-20 `transfer` hidden inside an arbitrary contract-call's
 * calldata — see `decodeErc20Recipient` below). `sendingTokenContract` is
 * the contract address of the token actually being sent (`undefined` for a
 * native-coin send, which this guard is a no-op for — there is no "the ETH
 * contract" to accidentally send ETH to).
 */
export function assertSafeTokenTransferDestination(
  chain: string,
  recipient: string,
  sendingTokenContract: string | undefined
): void {
  if (!sendingTokenContract) return
  const hit = knownTokensIndex[chain as Chain]?.[recipient.toLowerCase()]
  if (!hit) return
  const isSameToken = recipient.toLowerCase() === sendingTokenContract.toLowerCase()
  if (isSameToken) {
    throw new Error(
      `Refusing to build transaction: sending ${hit.ticker} to the ${hit.ticker} token contract ` +
        `(${recipient}) would permanently burn it — the contract cannot credit a balance to itself. ` +
        'Did you mean to send to a wallet address instead?'
    )
  }
  throw new Error(
    `Refusing to build transaction: destination ${recipient} is the ${hit.ticker} token contract on ${chain}, ` +
      'not a wallet — tokens sent to a token contract are permanently unrecoverable. ' +
      'Did you mean to send to a wallet address instead?'
  )
}

// ── ERC-20 calldata recipient decoding ───────────────────────────────────────

const ERC20_TRANSFER_SELECTOR = '0xa9059cbb'
const ERC20_TRANSFER_FROM_SELECTOR = '0x23b872dd'
// ERC-721 safeTransferFrom — same recipient offset as ERC-20 transferFrom
// (second 32-byte slot). Two overloads; both hit the same decode path:
//   safeTransferFrom(address,address,uint256)       → 0x42842e0e (3-arg)
//   safeTransferFrom(address,address,uint256,bytes) → 0xb88d4fde (4-arg, common in wallet SDKs)
const ERC721_SAFE_TRANSFER_FROM_SELECTOR = '0x42842e0e'
const ERC721_SAFE_TRANSFER_FROM_BYTES_SELECTOR = '0xb88d4fde'

/**
 * True when `data`'s selector is a plain ERC-20 `transfer`/`transferFrom` —
 * the two calldata shapes where the call target IS the token being moved, so
 * a recipient that is itself a known token contract strands the funds and
 * `assertSafeTokenTransferDestination` applies. ERC-721 `safeTransferFrom`
 * deliberately returns false: the 721 standard's on-chain `onERC721Received`
 * check already reverts a transfer to a non-receiver contract, so extending
 * the registry guard there would add false-positive surface without closing
 * a loss path. Every other selector is an arbitrary contract call and stays
 * out of scope.
 */
export function isErc20TransferCalldata(data: string): boolean {
  if (typeof data !== 'string') return false
  const hex = data.startsWith('0x') ? data : `0x${data}`
  const selector = hex.slice(0, 10).toLowerCase()
  return selector === ERC20_TRANSFER_SELECTOR || selector === ERC20_TRANSFER_FROM_SELECTOR
}

/**
 * If `data` looks like an ERC-20 `transfer`/`transferFrom` (or the
 * same-shaped ERC-721 `safeTransferFrom`) call, return the decoded recipient
 * address (lower-cased, `0x`-prefixed). Otherwise returns `null`.
 *
 * A contract-call builder that sets `to = <token contract>` + `data =
 * <encoded transfer>` must run this to check the ACTUAL recipient —
 * otherwise a destination guard that only vets the token contract address
 * lets the real recipient slip through unchecked.
 *
 * Calldata layout for `transfer(address,uint256)`:
 *   0x00–0x04  selector (4 bytes)
 *   0x04–0x24  recipient (32-byte padded; address in last 20 bytes)
 *   0x24–0x44  amount
 *
 * For `transferFrom(address,address,uint256)` (ERC-20) and
 * `safeTransferFrom(address,address,uint256[,bytes])` (ERC-721 — same head layout):
 *   0x00–0x04  selector
 *   0x04–0x24  sender
 *   0x24–0x44  recipient
 *   0x44–0x64  amount / tokenId
 */
export function decodeErc20Recipient(data: string): string | null {
  if (typeof data !== 'string') return null
  const hex = data.startsWith('0x') ? data : `0x${data}`
  if (hex.length < 10) return null
  const selector = hex.slice(0, 10).toLowerCase()

  let recipientSliceStart: number
  if (selector === ERC20_TRANSFER_SELECTOR) {
    // recipient is at bytes 4..36 → hex chars 10..74, last 40 chars = addr
    recipientSliceStart = 10
  } else if (
    selector === ERC20_TRANSFER_FROM_SELECTOR ||
    selector === ERC721_SAFE_TRANSFER_FROM_SELECTOR ||
    selector === ERC721_SAFE_TRANSFER_FROM_BYTES_SELECTOR
  ) {
    // recipient is at bytes 36..68 → hex chars 74..138, last 40 chars = addr
    recipientSliceStart = 74
  } else {
    return null
  }

  const slotEnd = recipientSliceStart + 64
  if (hex.length < slotEnd) return null
  const slot = hex.slice(recipientSliceStart, slotEnd)
  // Recipient occupies the last 40 hex chars (rightmost 20 bytes) of the slot.
  const addr = `0x${slot.slice(24).toLowerCase()}`
  if (!EVM_ADDRESS_RE.test(addr)) return null
  return addr
}

// ERC-20 approve(address spender, uint256 amount) — 0x095ea7b3. The SPENDER
// receives spend authority over the owner's tokens; a raw approve built via
// an arbitrary contract-call path is OPAQUE (no spender decode, no
// WYSIWYS surface) unless decoded explicitly.
export const ERC20_APPROVE_SELECTOR = '0x095ea7b3'

/**
 * If `data` is an ERC-20 `approve(address spender, uint256 amount)` call,
 * decode the SPENDER (lower-cased, `0x`-prefixed) + the raw allowance
 * amount. Otherwise null. Mirrors `decodeErc20Recipient`'s slot math:
 * spender = first 32-byte slot (bytes 4..36), amount = second slot (bytes
 * 36..68).
 */
export function decodeErc20Approve(data: string): { spender: string; amount: bigint } | null {
  if (typeof data !== 'string') return null
  const hex = data.startsWith('0x') ? data : `0x${data}`
  if (hex.slice(0, 10).toLowerCase() !== ERC20_APPROVE_SELECTOR) return null
  // 4-byte selector + 32-byte spender + 32-byte amount = 138 hex chars incl the `0x`.
  if (hex.length < 138) return null
  const spender = `0x${hex.slice(10, 74).slice(24).toLowerCase()}`
  if (!EVM_ADDRESS_RE.test(spender)) return null
  let amount: bigint
  try {
    amount = BigInt(`0x${hex.slice(74, 138)}`)
  } catch {
    return null
  }
  return { spender, amount }
}

/**
 * Extract the ERC-20/721 transfer RECIPIENT from a `function_sig` + `args`
 * shape — the alternative to raw ABI-encoded `data` some builders accept
 * (function signature + positional args, ABI-encoded server/caller-side
 * AFTER any pre-dispatch destination guard already ran). Without this, a
 * transfer expressed as `function_sig: "transfer(address,uint256)"` +
 * `args: [<recipient>, <amount>]` has no `data` for `decodeErc20Recipient`
 * to see and a destination guard silently no-ops.
 *
 * Mirrors `decodeErc20Recipient`'s selector→slot mapping on the parsed
 * signature: `transfer(address,uint256)` → `args[0]`;
 * `transferFrom`/`safeTransferFrom(address from,address to,…)` → `args[1]`
 * (the recipient is the SECOND address, never `from`). A non-transfer
 * signature (or one that doesn't match either shape) → `null`.
 */
export function decodeErc20RecipientFromSig(functionSig: unknown, args: unknown): string | null {
  if (typeof functionSig !== 'string' || !Array.isArray(args)) return null
  // Accept "function transfer(address,uint256)" or "transfer(address,uint256)".
  const m = functionSig
    .replace(/^\s*function\s+/i, '')
    .trim()
    .match(/^(\w+)\s*\(([^)]*)\)/)
  if (!m) return null
  const name = m[1]
  // Strip any inline arg names ("address to" → "address") so we compare pure types.
  const argTypes = m[2].split(',').map(t => t.trim().split(/\s+/)[0])
  let idx: number
  if (name === 'transfer' && argTypes[0] === 'address') {
    idx = 0 // transfer(address to, uint256 amount) — recipient is the FIRST arg
  } else if (
    (name === 'transferFrom' || name === 'safeTransferFrom') &&
    argTypes[0] === 'address' &&
    argTypes[1] === 'address'
  ) {
    idx = 1 // transferFrom/safeTransferFrom(address from, address to, …) — recipient is the SECOND arg
  } else {
    return null
  }
  const raw = args[idx]
  if (typeof raw !== 'string') return null
  const addr = raw.trim().toLowerCase()
  return EVM_ADDRESS_RE.test(addr) ? addr : null
}
