import type { JupiterFeeAccount } from '@vultisig/core-chain/swap/general/jupiter/api/jupiterFeeAta'
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

/** @deprecated Jupiter fee accounts are derived and prepended per swap. */
export const JUPITER_AFFILIATE_FEE_ATAS: Readonly<Record<string, string>> = {}

/**
 * Resolve the affiliate fee account for a given output mint.
 * The fee ATA is derived for `(JUPITER_AFFILIATE_FEE_OWNER, outputMint)` and
 * later prepended as an idempotent create instruction, so callers do not need
 * a pre-created treasury ATA.
 */
export const resolveJupiterFeeAccount = async (outputMint: string): Promise<JupiterFeeAccount> => {
  // Lazy: `jupiterFeeAta` statically pulls `@solana/web3.js` and `getSolanaClient`.
  // This module is on the eager RN path, so importing it at module init would
  // drag Hermes-hostile Solana client initialization into the RN bundle - the
  // exact thing splitting the config off `jupiter.ts` exists to avoid.
  const { deriveJupiterFeeAccount } = await import(
    '@vultisig/core-chain/swap/general/jupiter/api/jupiterFeeAta'
  )

  return deriveJupiterFeeAccount({
    outputMint,
    feeOwner: JUPITER_AFFILIATE_FEE_OWNER,
  })
}
