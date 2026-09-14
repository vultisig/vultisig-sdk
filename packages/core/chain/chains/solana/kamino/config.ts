import { rootApiUrl } from '@vultisig/core-config'

/**
 * Constants for Kamino Earn vaults (kVaults) on Solana.
 *
 * The REST API is public and unauthenticated — the action endpoints build an
 * unsigned transaction from the caller's wallet address alone, which is why
 * every built transaction must be validated on-device before it is signed.
 */
export const kaminoConfig = {
  /**
   * Kamino's REST API, reached through the Vultisig proxy like every other
   * third-party API this package calls.
   *
   * Not a preference. Upstream answers the CORS preflight with a 404 and
   * returns no `access-control-allow-origin` on the build endpoints, so a
   * browser refuses the POST that deposits and withdrawals depend on. Native
   * clients never notice — CORS is enforced by the browser, not the server —
   * which is why this surfaced only in a webview.
   */
  apiBaseUrl: `${rootApiUrl}/kamino`,

  /** The kVaults program every deposit and withdraw invokes. */
  programId: 'KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd',

  /**
   * Kamino's farms program. Every launch vault has a farm attached, so a
   * deposit ends with `initializeUser` + `stake` against this program and the
   * shares never land in the user's wallet.
   */
  farmsProgramId: 'FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr',

  /**
   * Wrapped SOL. The SOL vault's underlying token is this mint, not native
   * SOL, which is why its deposits carry a wrap prefix.
   */
  wrappedSolMint: 'So11111111111111111111111111111111111111112',

  /** Circle's USDC — the underlying token of both dollar vaults. */
  usdcMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
} as const
