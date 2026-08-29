/**
 * AgentRouter / USDC checkout canonicals (architecture#1949).
 *
 * Ported from two independently-drifting copies — `agent-backend-ts`'s
 * `src/mastra/tools/mcp/tools/payments/{usdcCalldata,usdcContracts}.ts` and
 * `vultiagent-app`'s `src/features/credits/lib/usdcCalldata.ts` — into a
 * single SDK-owned contract so the checkout display formatting, the
 * AgentRouter `depositWithMemo` calldata encode/decode, and the supported
 * checkout USDC/chain registry can't drift again the way they already have
 * once (app issue #2528: the backend's rounded-display semantics changed,
 * the app's parser still assumed an exact microdollar round-trip).
 *
 * `approve(spender, amount)` calldata is NOT re-declared here — both
 * existing copies already just call the SDK's generic
 * `encodeErc20Approve` (`./encodeErc20Approve`); a checkout-specific
 * wrapper would only add an alias, not a decision.
 *
 * `depositWithMemo` encode/decode is ABI-driven via viem instead of the
 * hand-rolled hex-padding both copies used — `decodeAgentRouterDepositWithMemo`
 * therefore also recovers the memo (both source copies only decoded the
 * static token/amount head, never the dynamic memo tail).
 */
import { decodeFunctionData, encodeFunctionData, getAddress, hexToBytes, stringToHex } from 'viem'

// --- USDC payment-chain registry ---

/**
 * Canonical USDC payment-chain metadata for credit-pack / subscription
 * checkout. Circle's official native-issuance USDC contracts; AgentRouter
 * is deployed at the same CREATE2 address on all three via
 * `AGENT_ROUTER_ADDRESS`. `scannerChain` is the lowercase slug the deposit
 * scanner keys its `eth_getLogs` polling loop by — kept alongside the
 * checkout-facing PascalCase chain name so the two sides of a checkout
 * (builder + scanner) can't independently drift on chain identity.
 */
export const USDC_PAYMENT_CHAIN_CONFIG = {
  Ethereum: {
    scannerChain: 'ethereum',
    chainId: 1,
    contract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  },
  Arbitrum: {
    scannerChain: 'arbitrum',
    chainId: 42161,
    contract: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  },
  Base: {
    scannerChain: 'base',
    chainId: 8453,
    contract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  },
} as const

export const USDC_PAYMENT_CHAINS = Object.freeze(
  Object.keys(USDC_PAYMENT_CHAIN_CONFIG)
) as ReadonlyArray<keyof typeof USDC_PAYMENT_CHAIN_CONFIG>
export type UsdcPaymentChain = (typeof USDC_PAYMENT_CHAINS)[number]
export type UsdcPaymentChainConfig = (typeof USDC_PAYMENT_CHAIN_CONFIG)[UsdcPaymentChain]

/** USDC has 6 decimals on every supported checkout chain. */
export const USDC_PAYMENT_DECIMALS = 6

/** Convenience flat map, `{ Ethereum: '0xA0b8...', ... }` — same shape both prior copies exposed. */
export const USDC_CONTRACTS: Record<UsdcPaymentChain, string> = Object.fromEntries(
  USDC_PAYMENT_CHAINS.map(chain => [chain, USDC_PAYMENT_CHAIN_CONFIG[chain].contract])
) as Record<UsdcPaymentChain, string>

/** Convenience flat map, `{ Ethereum: 1, ... }` — same shape both prior copies exposed. */
export const CHECKOUT_CHAIN_IDS: Record<UsdcPaymentChain, number> = Object.fromEntries(
  USDC_PAYMENT_CHAINS.map(chain => [chain, USDC_PAYMENT_CHAIN_CONFIG[chain].chainId])
) as Record<UsdcPaymentChain, number>

export function isUsdcPaymentChain(chain: string): chain is UsdcPaymentChain {
  return Object.hasOwn(USDC_PAYMENT_CHAIN_CONFIG, chain)
}

/** Canonical payment config by checkout-chain display name (Ethereum/Base/Arbitrum). */
export function lookupUsdcPaymentChain(chain: string): UsdcPaymentChainConfig | undefined {
  if (!isUsdcPaymentChain(chain)) return undefined
  return USDC_PAYMENT_CHAIN_CONFIG[chain]
}

/** Resolve the USDC contract address for a checkout chain. Throws if unsupported. */
export function resolveUsdcPaymentContract(chain: string): string {
  const config = lookupUsdcPaymentChain(chain)
  if (!config) {
    throw new Error(
      `resolveUsdcPaymentContract: chain "${chain}" is not supported for USDC checkout. ` +
        `Supported: ${USDC_PAYMENT_CHAINS.join(', ')}`
    )
  }
  return config.contract
}

/** Resolve the EVM chain ID for a checkout chain. Throws if unsupported. */
export function resolveUsdcPaymentChainId(chain: string): number {
  const config = lookupUsdcPaymentChain(chain)
  if (!config) {
    throw new Error(
      `resolveUsdcPaymentChainId: no chain ID for "${chain}". Supported: ${USDC_PAYMENT_CHAINS.join(', ')}`
    )
  }
  return config.chainId
}

// --- Checkout display formatting ---

/**
 * Format a microdollar amount (1 USD = 1_000_000) as a human-readable USD
 * decimal string, e.g. `1_995_500 -> "2.00"`. Half-away-from-zero rounding
 * to the nearest cent — the SAME semantics `agent-backend-ts`'s
 * `formatUSDC` uses for the checkout confirmation total. This is the exact
 * contract whose drift (backend rounds, app assumed an exact round-trip)
 * produced app issue #2528 — the checkout amount display and any
 * microdollar -> decimal parsing MUST go through this one function.
 */
export function formatCheckoutUsdcDisplay(microdollars: number): string {
  if (!Number.isSafeInteger(microdollars)) {
    throw new Error('formatCheckoutUsdcDisplay: microdollars must be a safe integer')
  }

  const negative = microdollars < 0
  const abs = Math.abs(microdollars)
  // Round to nearest cent: add half a cent (5_000 microdollars) before truncating.
  const rounded = abs + 5_000
  const whole = Math.floor(rounded / 1_000_000)
  const fracHundredths = Math.floor((rounded % 1_000_000) / 10_000)
  const sign = negative ? '-' : ''
  return `${sign}${whole}.${String(fracHundredths).padStart(2, '0')}`
}

// --- AgentRouter depositWithMemo calldata ---

/**
 * AgentRouter contract address — deterministic CREATE2 deployment, same
 * address on every supported EVM checkout chain (Ethereum, Arbitrum, Base).
 */
export const AGENT_ROUTER_ADDRESS = '0xFEEEeeEE643d6AD9eBC6B2025a03eB2290A72bBf'

/**
 * 4-byte ABI selector for `depositWithMemo(address,uint256,bytes)`.
 * `keccak256("depositWithMemo(address,uint256,bytes)")[0:4] = 0xd7c113a9`.
 * Verified present in the AgentRouter bytecode at `AGENT_ROUTER_ADDRESS`.
 * Exported for callers that need to recognize the selector without pulling
 * in an ABI decoder (e.g. a lightweight prefix check).
 */
export const AGENT_ROUTER_DEPOSIT_WITH_MEMO_SELECTOR = '0xd7c113a9'

const AGENT_ROUTER_DEPOSIT_WITH_MEMO_ABI = [
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

/**
 * Build ABI-encoded calldata for `AgentRouter.depositWithMemo(token, amount, memo)`.
 *
 * The user calls this after approving the router (see `encodeErc20Approve`
 * in `./encodeErc20Approve`). The router emits
 * `Deposit(address indexed token, address indexed from, uint256 amount, bytes memo)`,
 * which the deposit scanner watches via `eth_getLogs` — the memo is in the
 * event data itself, no extra `eth_getTransactionByHash` round-trip needed.
 *
 * @param token  USDC contract address on the target chain (see `resolveUsdcPaymentContract`).
 * @param amount Amount in USDC base units (microdollars; 6 decimals — 1 USDC = 1_000_000).
 * @param memo   Checkout memo string (e.g. `"cp_ABCDEF123456"`), UTF-8 encoded.
 * @returns 0x-prefixed calldata.
 */
export function encodeAgentRouterDepositWithMemo(token: string, amount: bigint, memo: string): `0x${string}` {
  return encodeFunctionData({
    abi: AGENT_ROUTER_DEPOSIT_WITH_MEMO_ABI,
    functionName: 'depositWithMemo',
    args: [getAddress(token), amount, stringToHex(memo)],
  })
}

export type DecodedAgentRouterDeposit = {
  token: string
  amount: bigint
  memo: string
}

/**
 * Decode `AgentRouter.depositWithMemo(token, amount, memo)` calldata.
 *
 * Returns `null` when the selector doesn't match or the calldata is
 * malformed/truncated — callers MUST treat `null` as fail-closed, never as
 * "no deposit". Recovers the full memo (both prior hand-rolled copies of
 * this decoder only decoded the static token/amount head).
 */
export function decodeAgentRouterDepositWithMemo(calldata: string): DecodedAgentRouterDeposit | null {
  try {
    const normalized = calldata.startsWith('0x') ? (calldata as `0x${string}`) : (`0x${calldata}` as `0x${string}`)
    const { args } = decodeFunctionData({ abi: AGENT_ROUTER_DEPOSIT_WITH_MEMO_ABI, data: normalized })
    const [token, amount, memoHex] = args
    const memo = new TextDecoder('utf-8', { fatal: true }).decode(hexToBytes(memoHex))
    return { token, amount, memo }
  } catch {
    return null
  }
}
