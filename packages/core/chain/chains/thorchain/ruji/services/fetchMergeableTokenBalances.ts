type TokenBalance = {
  symbol: string
  sharesChain: string
  sizeAmountChain: string
}

/**
 * @deprecated The KUJI-to-RUJI merge window closed on 2026-04-05.
 *
 * Kept as an inert compatibility shim for the published package subpath.
 */
export const fetchMergeableTokenBalances = async (_thorAddr: string): Promise<TokenBalance[]> => []
