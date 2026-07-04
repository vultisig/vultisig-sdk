/**
 * Shared types for the Osmosis DeFi message builders.
 *
 * These mirror the on-chain proto3 field names but use base-unit string
 * amounts everywhere (sdk.Int / sdk.Coin.amount are big integers, JS `number`
 * can't represent them without precision loss).
 */

/** A `cosmos.base.v1beta1.Coin` with a base-unit (integer string) amount. */
export type Coin = {
  denom: string
  /** Base-unit integer string, e.g. "5000000" for 5 OSMO (6 decimals). */
  amount: string
}

/**
 * An encoded protobuf `google.protobuf.Any` wrapping a single Osmosis message.
 *
 * `typeUrl` is the canonical fully-qualified message type (e.g.
 * `/osmosis.gamm.v1beta1.MsgJoinPool`). `value` is the proto3-encoded message
 * body. This is exactly the shape a Cosmos `TxBody.messages` entry expects, so
 * a consumer can drop it straight into a SignDirect `bodyBytes` build.
 */
export type EncodedMsg = {
  typeUrl: string
  value: Uint8Array
}

/**
 * Optional affiliate/fee injection. The SDK is multi-consumer and NEVER hard-codes
 * a fee recipient — a consumer that wants to attach an on-chain affiliate hop (e.g.
 * a downstream MsgSend to a fee collector bundled alongside the DeFi msg) passes it
 * here. Defaults to OFF (no affiliate msg appended). The msg builders themselves do
 * not mutate the user's amounts; affiliate handling, if any, is the consumer's
 * responsibility — this type exists so the surface is forward-compatible and the
 * intent (injectable, never hardcoded) is explicit at the API boundary.
 */
export type OsmosisAffiliateConfig = {
  /** osmo1... recipient of the affiliate fee. Required if `bps > 0`. */
  recipient?: string
  /** Affiliate fee in basis points (1 bp = 0.01%). Default 0 (off). */
  bps?: number
}
