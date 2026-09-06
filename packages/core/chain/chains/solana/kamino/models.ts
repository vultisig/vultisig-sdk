import { KaminoShareAmount, KaminoTokenAmount } from './amount'
import { KaminoRate } from './rate'
import { KaminoVaultDescriptor } from './registry'

/**
 * `GET /kvaults/vaults/{address}`. Every numeric field arrives as a string;
 * nothing here may be consumed without going through the typed amounts.
 */
export type KaminoVaultStateResponse = {
  address: string
  programId: string
  state: {
    name: string
    tokenMint: string
    tokenMintDecimals: number
    sharesMint: string
    /**
     * Share decimals are independent of token decimals — across the live vault
     * set the pairs include (6,6), (6,9), (8,8) and (9,9). Never assume they
     * match.
     */
    sharesMintDecimals: number
    /**
     * Base units of the **underlying token**. Correctly denominated, unlike
     * `minWithdrawAmount` — but still not a figure the program accepts: a
     * deposit at exactly this amount is refused. Only the effective-minimum
     * derivation in `fetchKaminoVaultInfo` may read it.
     */
    minDepositAmount: string
    /**
     * Base units of the **underlying token**, despite naming the unit the
     * withdraw endpoint takes. Reading it as a share count is a silent error on
     * a dollar vault (the rate is near 1) and a ~930× one on the SOL vault. It
     * is also not the floor the program enforces — see the effective-minimum
     * derivation in `fetchKaminoVaultInfo`, which is what forms should use.
     * Nothing but that derivation may read this field.
     */
    minWithdrawAmount: string
    /** Address lookup table the built transactions reference. */
    vaultLookupTable: string
    /**
     * When set, deposits auto-stake the shares into this farm and they never
     * appear in the user's associated token account.
     */
    vaultFarm: string
    performanceFeeBps: number
    managementFeeBps: number
  }
}

/**
 * `GET /kvaults/vaults/{address}/metrics`. Every numeric field is a decimal
 * string; APYs are fractions (`"0.0391"` = 3.91%), not percentages.
 */
export type KaminoVaultMetricsResponse = {
  apy30d: string
  /** Underlying tokens per share — the rate for valuing a position. */
  tokensPerShare: string
  /** USD per share. NOT interchangeable with `tokensPerShare`. */
  sharePrice: string
  tokenPrice: string
  tokensAvailable: string
  tokensInvested: string
}

/**
 * One element of `GET /kvaults/users/{owner}/positions`. Shares only — the
 * endpoint returns no token or fiat value.
 */
export type KaminoUserPositionResponse = {
  vaultAddress: string
  /**
   * Shares held inside the vault's farm. For a farmed vault this is where a
   * deposit lands, so it is normally the whole position.
   */
  stakedShares: string
  /** Shares sitting in the user's associated token account. */
  unstakedShares: string
  totalShares: string
}

/** `GET /kvaults/users/{owner}/vaults/{vault}/pnl`. */
export type KaminoPnlResponse = {
  totalCostBasis: KaminoPnlAmounts
  totalPnl: KaminoPnlAmounts
}

/** One PnL figure expressed in the three denominations the API reports. */
export type KaminoPnlAmounts = {
  token: string
  sol: string
  usd: string
}

/**
 * A launch vault after its registry entry has been merged with live API state
 * and metrics. This is what the feature layer consumes; the raw responses stay
 * at the service boundary. The vault's identity (mints, decimals, farm) is
 * read from `descriptor` — the registry's record — never from the response: a
 * transaction built by the API cannot be validated against values the same API
 * supplied.
 */
export type KaminoVaultInfo = {
  descriptor: KaminoVaultDescriptor
  /** On-chain vault name (`"Steakhouse USDC"`). */
  name: string
  /**
   * The smallest deposit a form may offer.
   *
   * DERIVED: the published `minDepositAmount` plus a margin, because the
   * program refuses a deposit at exactly the published figure. See
   * `fetchKaminoVaultInfo`.
   */
  minDeposit: KaminoTokenAmount
  /**
   * The smallest withdraw a form may offer, in SHARE base units.
   *
   * DERIVED, not `state.minWithdrawAmount` read at face value: that field is
   * denominated in the underlying token and the program's own floor is higher
   * than it. Because the derivation goes through `tokensPerShare`, this figure
   * moves with the rate, and it is hydrated in the same response.
   */
  minWithdraw: KaminoShareAmount
  /**
   * The address lookup table the built transactions reference.
   *
   * Live rather than pinned: unlike the mints and the farm, Kamino can
   * legitimately repoint a vault at a new table. A substituted table renames
   * an account into a mismatch rather than out of one, so no transaction check
   * rests on it.
   */
  lookupTable: string
  /** 30-day APY as a fraction (0.0391 = 3.91%). Display-only. */
  apy30d: number
  /**
   * Underlying tokens per share, kept exact: this rate sizes a withdraw, and a
   * rounding error in it can over-request shares.
   */
  tokensPerShare: KaminoRate
  /** USD price of the underlying token. Display-only. */
  tokenPriceUsd: number
  /**
   * The underlying balance the vault currently holds liquid, rather than
   * invested in lending reserves. `undefined` when the metrics response did
   * not carry a readable value.
   *
   * Advisory only — it says what a withdraw is likely to be able to settle
   * immediately, and nothing sizes a transaction from it. The measured ratio
   * is well under 1% of the launch vaults, so a withdraw above this buffer is
   * the ordinary case, not an exception.
   */
  tokensAvailable?: KaminoTokenAmount
}
