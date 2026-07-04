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

/** SOL native mint address (used when no SPL token contract is specified). */
export const SOL_NATIVE_MINT = 'So11111111111111111111111111111111111111112'

/**
 * Treasury OWNER pubkey on Solana. This is NOT the `feeAccount` itself.
 * Jupiter's `feeAccount` field expects an SPL Token ATA derived per output
 * mint and owned by this pubkey. Confirmed by realpaaao on 2026-06-01
 * (vultisig/agent-backend#631): "Solana address is: 5QXe... Use same swap
 * config as in core app."
 */
export const JUPITER_AFFILIATE_FEE_OWNER = '5QXePTiaWgmqSCHh9YDWAiVvEeKWaM5cUN62K4SXwUSB'

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
 * Default slippage in basis points (1%). Matches the slippage used in
 * recipes/sdk/swap/jupiter.go.
 */
export const JUPITER_DEFAULT_SLIPPAGE_BPS = 100

const JUPITER_TIMEOUT_MS = 15_000

/**
 * Pre-created SPL Token ATAs owned by `JUPITER_AFFILIATE_FEE_OWNER`, keyed
 * by output mint. Each value MUST be the canonical associated-token-account
 * for that mint+owner pair AND must already exist on-chain (Jupiter's
 * post-swap transfer reverts with SPL Token program error 0x17
 * InvalidAccountData if the destination ATA is not initialised).
 *
 * Empty today: no ATAs created at the treasury yet, so the affiliate fee is
 * OFF on every Solana output until at least one entry lands here. Solana →
 * Solana swaps still route through Jupiter direct; they just do not collect
 * the 50 bps fee yet. Add an entry only after `spl-token create-account
 * <mint>` lands against the treasury keypair and the on-chain ATA is
 * verified (mint + owner match).
 */
export const JUPITER_AFFILIATE_FEE_ATAS: Readonly<Record<string, string>> = {}

/**
 * Resolve the affiliate fee account for a given output mint. Returns the
 * pre-configured ATA when one exists for that mint, or `null` when the
 * affiliate path is not yet wired for that mint (treasury ATA not created).
 *
 * Callers MUST treat `null` as "skip affiliate fee on this swap" — that
 * means omitting BOTH `platformFeeBps` from the /quote request AND
 * `feeAccount` from the /swap request body. Passing `platformFeeBps`
 * without a valid `feeAccount` would have Jupiter quote a route the user
 * cannot actually execute (the route accounting includes a fee transfer
 * with nowhere to go).
 */
export const resolveJupiterFeeAccount = (outputMint: string): string | null =>
  JUPITER_AFFILIATE_FEE_ATAS[outputMint] ?? null

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
  /** Slippage tolerance in basis points (default 100 = 1%). */
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
  resolveFeeAccount?: (outputMint: string) => string | null
}

/**
 * Fetch a Jupiter quote and build the UNSIGNED swap transaction for a
 * Solana → Solana swap, with the Vultisig affiliate fee wired in when a
 * treasury ATA is configured for the output mint. Returns a fully-serialized
 * VersionedTransaction (base64) plus route + amount metadata.
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

  // Resolve the per-output-mint affiliate fee account. When no pre-created
  // ATA is configured for the output mint we SKIP the affiliate fee on this
  // swap (omit BOTH platformFeeBps AND feeAccount) — passing one without the
  // other would have Jupiter quote a route the user cannot execute.
  const feeAccount = resolveFeeAccount(outputMint)

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

  // Step 2: Build the (unsigned) swap transaction. Include feeAccount only
  // when resolved.
  const swapBody: Record<string, unknown> = {
    userPublicKey,
    quoteResponse: quote,
    wrapAndUnwrapSol: true,
    useSharedAccounts: true,
    asLegacyTransaction: false,
    dynamicComputeUnitLimit: true,
  }
  if (feeAccount) {
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

  return {
    swapTransaction: swapResp.swapTransaction,
    outAmount: quote.outAmount,
    minOutAmount: quote.otherAmountThreshold,
    priceImpactPct: quote.priceImpactPct,
    routeLabels: quote.routePlan.map(r => r.swapInfo.label ?? r.swapInfo.ammKey),
    affiliateFeeApplied: Boolean(feeAccount),
    inputMint,
    outputMint,
  }
}
