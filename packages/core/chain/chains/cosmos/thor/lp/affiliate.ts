/**
 * Vultisig affiliate identifier on THORChain.
 *
 * THORName "vi" is the Vultisig affiliate, used across iOS, Windows, and now
 * the agent stack to attribute swaps and LP actions on Midgard.
 *
 * Source of truth: VultisigApp/.../THORChainSwaps.swift uses
 * `affiliateFeeAddress = "vi"` and the production memo fixtures
 * (vultisig-ios/.../TestData/thorchainswap.json) carry `:vi:0`.
 *
 * v1 LP ships at 0 bps so we get Midgard affiliate-stats tracking without
 * taking a fee. Bump the bps constant when product agrees.
 */
export const VULTISIG_AFFILIATE_NAME = 'vi'
export const VULTISIG_AFFILIATE_LP_BPS = 0
