import { jupiterFeeOwnerAddress } from '@vultisig/core-chain/swap/general/jupiter/config'

/** SOL native mint address (used when no SPL token contract is specified). */
export const SOL_NATIVE_MINT = 'So11111111111111111111111111111111111111112'

/**
 * Treasury OWNER pubkey on Solana. This is NOT the `feeAccount` itself.
 * Jupiter's `feeAccount` field expects an SPL Token ATA derived per output
 * mint and owned by this pubkey.
 */
export const JUPITER_AFFILIATE_FEE_OWNER = jupiterFeeOwnerAddress

/** Affiliate fee in basis points (50 bps = 0.5%). */
export const JUPITER_PLATFORM_FEE_BPS = 50

/** Default base URL for Jupiter's V6 swap API. */
export const JUPITER_API_BASE_URL = 'https://api.vultisig.com/jup'

/** Default slippage in basis points (0.5%). */
export const JUPITER_DEFAULT_SLIPPAGE_BPS = 50

/** @deprecated Jupiter fee accounts are derived and prepended per swap. */
export const JUPITER_AFFILIATE_FEE_ATAS: Readonly<Record<string, string>> = {}
