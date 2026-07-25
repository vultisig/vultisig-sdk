import { jupiterFeeOwnerAddress } from '@vultisig/core-chain/swap/general/jupiter/config'

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
