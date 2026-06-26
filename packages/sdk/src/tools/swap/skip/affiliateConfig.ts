/**
 * Vultisig treasury / affiliate-fee recipient addresses for Skip swaps.
 *
 * The bps is set on the Skip `/route` request via `cumulative_affiliate_fee_bps`
 * — so it is ALREADY baked into the quote the user sees. But per Skip's
 * affiliate-fee docs (https://docs.skip.build/go/general/affiliate-fees), the
 * fee is only actually COLLECTED if the recipient address is supplied in
 * `chain_ids_to_affiliates` on `/msgs_direct`, keyed by the chain where the
 * swap executes (`route.swap_venue.chain_id`). Without it the fee routes to
 * nobody — worst-of-both-worlds (the user pays a worse quote, the protocol
 * receives nothing). The fee is ROUTED, not added on top: the same bps that was
 * already charged on `/route` is what we route here, so quotes do not get worse.
 *
 * Each address MUST be valid on its keyed chain — Skip returns a 400 if not.
 * Chains absent from this map simply collect no fee on that leg (partial
 * coverage beats zero).
 */
const STATION_EVM_FEE_RECEIVER = '0x649E1289fD780C2F9A3D27476511283EB0d0076D'

export const SKIP_AFFILIATE_ADDRESS_BY_CHAIN: Readonly<Record<string, string>> = {
  // Vultisig treasury fee recipients.
  'osmosis-1': 'osmo18ggw7cvgera63srls32a8fl4gtzmmphfzlfndf',
  // terra bech32 HRP is shared by phoenix-1 and columbus-5; same address valid on both.
  'phoenix-1': 'terra1lvhuqayxe4yrxa2js6lq9frnugflur2l2gwp7h',
  'columbus-5': 'terra1lvhuqayxe4yrxa2js6lq9frnugflur2l2gwp7h',
  // EVM swap-venue chains — keyed by Skip's decimal chain-id string.
  '1': STATION_EVM_FEE_RECEIVER, // Ethereum
  '42161': STATION_EVM_FEE_RECEIVER, // Arbitrum
  '10': STATION_EVM_FEE_RECEIVER, // Optimism
  '8453': STATION_EVM_FEE_RECEIVER, // Base
  '137': STATION_EVM_FEE_RECEIVER, // Polygon
  '43114': STATION_EVM_FEE_RECEIVER, // Avalanche
  '56': STATION_EVM_FEE_RECEIVER, // BSC
}

/**
 * The shape Skip expects in the `/msgs_direct` body's `chain_ids_to_affiliates`
 * field. Keyed by the swap chain id; `basis_points_fee` values across all
 * affiliates on a chain must SUM to the `cumulative_affiliate_fee_bps` sent on
 * `/route` (Skip rejects a mismatch). `basis_points_fee` is a string integer.
 */
export type SkipChainIdsToAffiliates = Record<string, { affiliates: { basis_points_fee: string; address: string }[] }>

/**
 * Build the `chain_ids_to_affiliates` entry for a single-swap-chain route.
 *
 * Returns `undefined` (omit the field entirely) when:
 *   - there is no affiliate bps to collect (`affiliateBps <= 0`), or
 *   - we have no confirmed treasury address for the swap chain.
 *
 * When present, the single affiliate's `basis_points_fee` equals the full
 * `affiliateBps`, so it sums to the `/route` `cumulative_affiliate_fee_bps`.
 */
export function buildSkipAffiliates(
  swapChainId: string | undefined,
  affiliateBps: number | undefined
): SkipChainIdsToAffiliates | undefined {
  if (!swapChainId) return undefined
  // Skip's basis_points_fee is an integer-bps string; a non-integer / NaN /
  // negative / >10000 value would either 400 or mis-route. Fail-closed: omit
  // the affiliate rather than send Skip garbage.
  if (affiliateBps === undefined || !Number.isInteger(affiliateBps) || affiliateBps <= 0 || affiliateBps > 10000) {
    return undefined
  }
  const address = SKIP_AFFILIATE_ADDRESS_BY_CHAIN[swapChainId]
  if (!address) return undefined
  return {
    [swapChainId]: {
      affiliates: [{ basis_points_fee: String(affiliateBps), address }],
    },
  }
}
