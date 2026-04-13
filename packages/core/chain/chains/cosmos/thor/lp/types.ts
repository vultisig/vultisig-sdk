export type ThorchainLpPosition = {
  pool: string
  liquidityUnits: string
  runeAdded: string
  assetAdded: string
  runePending: string
  assetPending: string
  runeAddress: string
  assetAddress: string
  /**
   * Unix seconds of the last add. Midgard returns this; thornode does not,
   * so positions sourced from the thornode fallback leave this as `"0"` and
   * populate `lastAddHeight` instead.
   */
  dateLastAdded: string
  /**
   * THORChain block height of the last add. Populated from thornode's
   * `last_add_height` when the position comes from the thornode fallback
   * path. Empty string when the position comes from Midgard (which does not
   * expose block height on `/v2/member`). Either field is sufficient to gate
   * the 1h lockup check — `dateLastAdded` via wall-clock window, or
   * `lastAddHeight` via block-count window.
   */
  lastAddHeight: string
  /**
   * True when either side has a non-zero pending amount. Common for
   * asymmetric adds that THORChain has not yet credited.
   */
  isPending: boolean
}

export type RawMemberPool = {
  pool?: string
  liquidityUnits?: string
  runeAdded?: string
  assetAdded?: string
  runePending?: string
  assetPending?: string
  runeAddress?: string
  assetAddress?: string
  dateLastAdded?: string
}

export type RawMemberResponse = {
  pools?: RawMemberPool[]
}
