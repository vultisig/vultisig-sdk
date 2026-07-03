/**
 * Direct Jupiter V6 swap integration for Solana → Solana swaps.
 *
 * `findSwapQuote` covers the cross-chain majors (THORChain / MayaChain /
 * 1inch / LiFi / KyberSwap) but does NOT cover same-chain Solana pairs.
 * This is the Solana leg: it fetches a Jupiter aggregator quote and builds
 * a fully-serialized, UNSIGNED VersionedTransaction the caller can hand to
 * Vultisig signing.
 *
 * Vault-free and pure crypto: it ONLY quotes + builds-unsigned. It never
 * signs and never broadcasts.
 *
 * Bypassing the SwapKit wrapper for same-chain Solana pairs is required so:
 *   1. `platformFeeBps` is included in the /quote request (Jupiter factors
 *      the affiliate fee into the quoted output amount and route plan).
 *   2. `feeAccount` is included in the /swap request (Jupiter deducts the
 *      fee and deposits it into the Vultisig treasury ATA on-chain).
 *
 * SwapKit cannot forward these fields through its wrapper — passing them
 * directly is the only way to ensure Vultisig collects affiliate fees on
 * Solana swaps.
 *
 * API reference: https://dev.jup.ag/docs/swap-api/get-quote
 *                https://dev.jup.ag/docs/swap-api/post-swap
 *
 * Ported from mcp-ts `src/tools/swap/jupiterSwap.ts` (0 SDK imports) as
 * part of the mcp-ts/backend → SDK code-as-action consolidation.
 */

import { PublicKey } from '@solana/web3.js'
import { assertSafeSolanaSwapTransactionBase64 } from '@vultisig/core-chain/chains/solana/assertSafeSolanaSwapInstructions'
import {
  deriveJupiterFeeAccount,
  type JupiterFeeAccount,
  prependJupiterFeeAta,
} from '@vultisig/core-chain/swap/general/jupiter/api/jupiterFeeAta'
import { jupiterFeeOwnerAddress } from '@vultisig/core-chain/swap/general/jupiter/config'
import {
  assertJupiterPriceImpactWithinCeiling,
  PriceImpactTooHighError,
} from '@vultisig/core-chain/swap/general/priceImpactGuard'

export { PriceImpactTooHighError }

/** SOL native mint address (used when no SPL token contract is specified). */
export const SOL_NATIVE_MINT = 'So11111111111111111111111111111111111111112'

/**
 * Treasury OWNER pubkey on Solana. This is NOT the `feeAccount` itself.
 * Jupiter's `feeAccount` field expects an SPL Token ATA derived per output
 * mint and owned by this pubkey.
 *
 * SOL-03 (audit fix): this used to hardcode a DIFFERENT address
 * ('5QXePTia...'), an ad-hoc unblock from a single GitHub comment
 * (vultisig/agent-backend#631, 2026-06-01) that predates and was never
 * reconciled with the later formal cross-platform shared-spec decision
 * (vultisig-ios#4669, vultisig-android#5053, vultisig-sdk#894) which settled
 * on '8iqhrtBz...' and already shipped on iOS/Android main. Re-export the
 * SDK's own general-swap config value so both Jupiter integrations agree.
 */
export const JUPITER_AFFILIATE_FEE_OWNER = jupiterFeeOwnerAddress

/**
 * Affiliate fee in basis points (50 bps = 0.5%). Mirrors `baseAffiliateBps`
 * and the bps used for THORChain / 1inch / KyberSwap / Skip.
 */
export const JUPITER_PLATFORM_FEE_BPS = 50

/**
 * Default base URL for Jupiter's V6 swap API. Routed through the Vultisig
 * proxy so rate-limits and observability stay on our side. Overridable per
 * call via the `apiBaseUrl` param.
 */
export const JUPITER_API_BASE_URL = 'https://api.vultisig.com/jup'

/**
 * Default slippage in basis points (0.5%).
 *
 * SOL-04 (audit fix): this used to be 100 bps, mirroring `recipes/sdk/swap/
 * jupiter.go`'s fallback constant — which itself predates and was never
 * reconciled with the shared cross-platform spec (vultisig-ios#4669) that
 * explicitly settled on 50 bps, matching iOS/Android/the SDK's own
 * general-swap Jupiter path (getJupiterSwapQuote.ts) and 1inch.
 */
export const JUPITER_DEFAULT_SLIPPAGE_BPS = 50

const JUPITER_TIMEOUT_MS = 15_000

/** @deprecated Jupiter fee accounts are derived and prepended per swap. */
export const JUPITER_AFFILIATE_FEE_ATAS: Readonly<Record<string, string>> = {}

/**
 * Resolve the affiliate fee account for a given output mint.
 * The fee ATA is derived for `(JUPITER_AFFILIATE_FEE_OWNER, outputMint)` and
 * later prepended as an idempotent create instruction, so callers do not need
 * a pre-created treasury ATA.
 */
export const resolveJupiterFeeAccount = (outputMint: string): Promise<JupiterFeeAccount> =>
  deriveJupiterFeeAccount({
    outputMint,
    feeOwner: JUPITER_AFFILIATE_FEE_OWNER,
  })

type JupiterFeeAccountResult = string | JupiterFeeAccount | null | undefined

/** Jupiter /quote response (subset we consume). */
export type JupiterQuoteResponse = {
  inputMint: string
  inAmount: string
  outputMint: string
  outAmount: string
  otherAmountThreshold: string
  swapMode: string
  slippageBps: number
  platformFee?: { amount: string; feeBps: number }
  priceImpactPct: string
  routePlan: Array<{
    swapInfo: {
      ammKey: string
      label?: string
      inputMint: string
      outputMint: string
      inAmount: string
      outAmount: string
      feeAmount: string
      feeMint: string
    }
    percent: number
  }>
}

type JupiterSwapResponse = {
  swapTransaction: string
  lastValidBlockHeight?: number
  prioritizationFeeLamports?: number
  computeUnitLimit?: number
  error?: string
}

/** Result of {@link buildJupiterSwapTx}. */
export type JupiterSwapResult = {
  /** Base64-encoded UNSIGNED VersionedTransaction ready for Vultisig signing. */
  swapTransaction: string
  /** Expected output amount in the destination token's base units. */
  outAmount: string
  /** Slippage-protected minimum output in base units. */
  minOutAmount: string
  /** Reported price impact as a decimal string (e.g. "0.0012"). */
  priceImpactPct: string
  /** Human-readable route labels (e.g. ["Whirlpool", "Meteora DLMM"]). */
  routeLabels: string[]
  /** Whether the Vultisig affiliate fee was wired into this swap. */
  affiliateFeeApplied: boolean
  /** Echo of the input mint actually quoted. */
  inputMint: string
  /** Echo of the output mint actually quoted. */
  outputMint: string
}

const fetchJupiter = async <T>(input: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(input, {
    ...init,
    signal: AbortSignal.timeout(JUPITER_TIMEOUT_MS),
  })

  const data = (await response.json().catch(() => undefined)) as unknown

  if (!response.ok) {
    const msg =
      typeof data === 'object' && data !== null && 'error' in data
        ? (data as { error: string }).error
        : response.statusText
    throw new Error(`Jupiter API error (${response.status}): ${msg}`)
  }

  return data as T
}

/**
 * Build the input/output mint addresses from token info. Falls back to the
 * SOL native mint when no SPL contract is provided.
 */
const toMint = (contractAddress: string | undefined): string => contractAddress?.trim() || SOL_NATIVE_MINT

export type JupiterSwapParams = {
  /** The signer's Solana base58 public key (owner of the swap). */
  userPublicKey: string
  /** Input token SPL mint. Omit / empty for native SOL. */
  fromContractAddress?: string
  /** Output token SPL mint. Omit / empty for native SOL. */
  toContractAddress?: string
  /** Exact input amount in lamports / token base units. */
  amountBaseUnits: bigint
  /** Slippage tolerance in basis points (default {@link JUPITER_DEFAULT_SLIPPAGE_BPS} = 50 = 0.5%). */
  slippageBps?: number
  /** Override the Jupiter API base URL (default {@link JUPITER_API_BASE_URL}). */
  apiBaseUrl?: string
  /**
   * Override the affiliate-fee-account resolver (default
   * {@link resolveJupiterFeeAccount}). Production callers MUST NOT pass this —
   * it exists purely as a test seam so the affiliate-ON path (omit-BOTH vs
   * include-BOTH platformFeeBps+feeAccount symmetry) can be exercised while the
   * canonical ATA map stays empty. A returned `null` keeps the affiliate fee
   * OFF (both fields omitted); a non-null ATA wires BOTH fields together.
   */
  resolveFeeAccount?: (outputMint: string) => JupiterFeeAccountResult | Promise<JupiterFeeAccountResult>
}

/**
 * Fetch a Jupiter quote and build the UNSIGNED swap transaction for a
 * Solana → Solana swap, with the Vultisig affiliate fee wired in when a
 * derived treasury ATA is available for the output mint. Returns a
 * fully-serialized VersionedTransaction (base64) plus route + amount metadata.
 *
 * Vault-free. Quotes + builds-unsigned only — never signs, never broadcasts.
 *
 * @example
 * ```ts
 * const swap = await buildJupiterSwapTx({
 *   userPublicKey: '5QXe...',
 *   // omit fromContractAddress for native SOL
 *   toContractAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
 *   amountBaseUnits: 100_000_000n, // 0.1 SOL
 * })
 * // swap.swapTransaction -> hand to Vultisig signing
 * ```
 */
export const buildJupiterSwapTx = async ({
  userPublicKey,
  fromContractAddress,
  toContractAddress,
  amountBaseUnits,
  slippageBps = JUPITER_DEFAULT_SLIPPAGE_BPS,
  apiBaseUrl = JUPITER_API_BASE_URL,
  resolveFeeAccount = resolveJupiterFeeAccount,
}: JupiterSwapParams): Promise<JupiterSwapResult> => {
  if (amountBaseUnits <= 0n) {
    throw new Error('Jupiter swap amount must be greater than zero')
  }

  const inputMint = toMint(fromContractAddress)
  const outputMint = toMint(toContractAddress)

  if (inputMint === outputMint) {
    throw new Error('Jupiter swap input and output mint must differ')
  }

  const base = apiBaseUrl.replace(/\/+$/, '')

  // Resolve the per-output-mint affiliate fee account. Production resolves the
  // ATA and prepends an idempotent create instruction below; test callers may
  // return a string to exercise quote/body symmetry without serializing a real tx.
  const feeAccountResult = await resolveFeeAccount(outputMint)
  const feeAccount = typeof feeAccountResult === 'string' ? feeAccountResult : feeAccountResult?.feeAccount

  // Step 1: Get a quote. Pass platformFeeBps ONLY when we have a valid
  // feeAccount for the output mint.
  const quoteParams = new URLSearchParams({
    inputMint,
    outputMint,
    amount: amountBaseUnits.toString(),
    slippageBps: String(slippageBps),
    swapMode: 'ExactIn',
  })
  if (feeAccount) {
    quoteParams.set('platformFeeBps', String(JUPITER_PLATFORM_FEE_BPS))
  }

  const quote = await fetchJupiter<JupiterQuoteResponse>(`${base}/swap/v1/quote?${quoteParams.toString()}`)

  // Price-impact ceiling (fund-safety, audit finding SOL-02). Jupiter's
  // priceImpactPct is a FRACTION ("0.05" = 5%); refuse to build a signable
  // swap transaction above the ceiling — a thin-pool / sandwich-bait quote
  // that would lose most of the user's funds. Fail-safe: a missing /
  // unparsable impact passes.
  assertJupiterPriceImpactWithinCeiling(quote.priceImpactPct)

  // Match the canonical core Jupiter path: requesting a platform fee is NOT
  // enough to prove one will actually be charged. Jupiter can floor
  // `platformFee.amount` to zero for tiny swaps or routes that do not charge a
  // fee. In that case we must omit `feeAccount` from /swap and surface the
  // result as fee-OFF, otherwise this direct SDK tool drifts from the shared
  // swap path and can misreport affiliate-fee state.
  const swapFeeAmount = BigInt(quote.platformFee?.amount ?? '0')
  const chargesFee = Boolean(feeAccount) && swapFeeAmount > 0n
  const quoteForSwap = chargesFee ? quote : { ...quote, platformFee: undefined }

  // Step 2: Build the (unsigned) swap transaction. Include feeAccount only
  // when the quoted route actually charges the affiliate fee.
  const swapBody: Record<string, unknown> = {
    userPublicKey,
    quoteResponse: quoteForSwap,
    wrapAndUnwrapSol: true,
    useSharedAccounts: true,
    asLegacyTransaction: false,
    dynamicComputeUnitLimit: true,
  }
  if (chargesFee) {
    swapBody.feeAccount = feeAccount
  }

  const swapResp = await fetchJupiter<JupiterSwapResponse>(`${base}/swap/v1/swap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(swapBody),
  })

  if (swapResp.error) {
    throw new Error(`Jupiter swap error: ${swapResp.error}`)
  }

  if (!swapResp.swapTransaction) {
    throw new Error('Jupiter swap response missing swapTransaction')
  }

  const swapTransaction =
    chargesFee && feeAccountResult && typeof feeAccountResult !== 'string'
      ? await prependJupiterFeeAta({
          txData: swapResp.swapTransaction,
          feeAccount: feeAccountResult.feeAccount,
          mintPubkey: feeAccountResult.mintPubkey,
          ownerPubkey: feeAccountResult.ownerPubkey,
          tokenProgramId: feeAccountResult.tokenProgramId,
          userWallet: new PublicKey(userPublicKey),
        })
      : swapResp.swapTransaction

  // Fund-safety guard (audit finding SOL-01, vultisig/vultisig-sdk#1056): this
  // is a second, independent Jupiter integration (bypasses the recipes/
  // getJupiterSwapQuote.ts path entirely) — the final transaction, including
  // any prepended idempotent fee-ATA instruction, must be validated before it
  // is handed back to the caller as signable.
  await assertSafeSolanaSwapTransactionBase64(swapTransaction, new PublicKey(userPublicKey))

  return {
    swapTransaction,
    outAmount: quote.outAmount,
    minOutAmount: quote.otherAmountThreshold,
    priceImpactPct: quote.priceImpactPct,
    routeLabels: quote.routePlan.map(r => r.swapInfo.label ?? r.swapInfo.ammKey),
    affiliateFeeApplied: chargesFee,
    inputMint,
    outputMint,
  }
}
