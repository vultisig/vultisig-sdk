import { kaminoConfig } from '../config'
import { KaminoVaultDescriptor } from '../registry'

/**
 * Compute-budget parameters for the ComputeBudget instructions the app
 * injects into Kamino's transactions.
 *
 * Kamino builds its transactions with NO ComputeBudget instruction at all,
 * and ignores fee fields in the request body — the response is byte-identical
 * with or without them. So the only way a Kamino transaction carries a
 * priority fee is for the app to inject one, and injecting a price without a
 * limit would price the fee off the runtime's default limit rather than the
 * units the transaction actually needs.
 *
 * The limits carry roughly a quarter over what each shape measured in mainnet
 * simulation (`err: null`): USDC deposit 252,146 · SOL deposit 287,029 ·
 * unstaked withdraw 173,251 · farm-staked withdraw up to 309,310. The margin
 * absorbs the drift a different account-existence mix causes — a deposit
 * whose share ATA or farm user account still has to be created does strictly
 * more work than one whose accounts already exist.
 */
export const kaminoComputeBudget = {
  /** Compute-unit limit for a deposit into a token vault. */
  tokenDepositUnitLimit: 320_000,
  /**
   * A SOL-vault deposit additionally creates the wSOL account, transfers into
   * it and syncs it, so it costs more than a token deposit.
   */
  nativeDepositUnitLimit: 350_000,
  /**
   * One limit for BOTH withdraw shapes, sized for the expensive one — the
   * farm-staked path runs two extra farms instructions and a second account
   * creation ahead of the vault withdraw. One value per operation keeps the
   * limit pinnable by the verify screen; the unstaked path pays a few
   * thousand lamports of headroom in exchange.
   */
  withdrawUnitLimit: 400_000,
  /**
   * Price used when the network's recent-fee sample is unavailable, in
   * micro-lamports per compute unit. The live median is preferred; this is
   * the floor beneath it — a sample below it would under-tip a transaction
   * that has to land before its blockhash expires.
   */
  fallbackUnitPriceMicroLamports: 20_000n,
  /**
   * Ceiling on the live price. The recent-fee sample is a number a remote
   * node hands us, multiplied by a six-figure compute limit into lamports the
   * user pays — unbounded, a wrong or hostile sample is an unbounded fee. At
   * this ceiling and the largest limit the priority fee tops out at 400,000
   * lamports (0.0004 SOL).
   */
  maxUnitPriceMicroLamports: 1_000_000n,
} as const

/**
 * The compute-unit limit this app injects for one operation against one
 * vault. Pinned rather than bounded by the checks: the app injects exactly
 * one value, so any other one did not come from it.
 */
export const kaminoExpectedUnitLimit = ({
  operation,
  descriptor,
}: {
  operation: 'deposit' | 'withdraw'
  descriptor: KaminoVaultDescriptor
}): number => {
  if (operation === 'withdraw') return kaminoComputeBudget.withdrawUnitLimit
  return descriptor.tokenMint === kaminoConfig.wrappedSolMint
    ? kaminoComputeBudget.nativeDepositUnitLimit
    : kaminoComputeBudget.tokenDepositUnitLimit
}

/**
 * Brings a sampled network price inside `[fallback, max]` — the fallback is a
 * floor rather than a default.
 */
export const clampKaminoUnitPrice = (sampled: bigint): bigint => {
  const { fallbackUnitPriceMicroLamports, maxUnitPriceMicroLamports } = kaminoComputeBudget
  const floored = sampled > fallbackUnitPriceMicroLamports ? sampled : fallbackUnitPriceMicroLamports
  return floored < maxUnitPriceMicroLamports ? floored : maxUnitPriceMicroLamports
}
