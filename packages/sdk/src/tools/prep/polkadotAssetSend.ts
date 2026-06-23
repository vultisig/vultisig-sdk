import { compactToU8a, u8aConcat, u8aToHex } from '@polkadot/util'
import { decodeAddress } from '@polkadot/util-crypto'

/**
 * Polkadot Asset Hub asset IDs for the well-known USD stablecoins. Not an
 * exhaustive registry — the builder accepts any valid u32 asset id so future
 * assets do not require a code change. This map only exists to surface a
 * friendly ticker/decimals default for the two common cases.
 */
export const POLKADOT_ASSET_HUB_KNOWN_ASSETS: Record<number, { ticker: string; decimals: number }> = {
  1984: { ticker: 'USDT', decimals: 6 },
  1337: { ticker: 'USDC', decimals: 6 },
}

/**
 * pallet_assets index on Polkadot Asset Hub (statemint). Native DOT lives in
 * pallet_balances (index 10); Asset Hub tokens live in pallet_assets (index 50).
 */
const PALLET_ASSETS = 50

/**
 * `transfer_keep_alive` call index inside pallet_assets on Asset Hub.
 *
 * transferKeepAlive (vs transfer / transfer_allow_death) prevents the sender's
 * asset account from being reaped below the pallet_assets minimum balance — the
 * safe default for agent-generated txs. This is the exact pallet/method pair the
 * downstream signer validates before signing (vultiagent-app
 * `assertAssetTransferCallHex`: pallet_assets.transferKeepAlive = 50/2).
 */
const METHOD_TRANSFER_KEEP_ALIVE = 2

const U32_MAX = 0xffffffff

export type PreparePolkadotAssetSendParams = {
  /** Asset Hub asset id (u32). USDT=1984, USDC=1337. */
  assetId: number
  /** Sender Polkadot SS58 address (prefix 0). Echoed back; not encoded into the call body. */
  from: string
  /** Destination Polkadot SS58 address. Decoded to its 32-byte AccountId and SCALE-encoded into the call. */
  to: string
  /** Amount in token base units (e.g. 1 USDT/USDC = 1_000_000 at 6 decimals). */
  amount: bigint
  /** Optional decimals override; defaults to the known-asset value when `assetId` is recognised. */
  decimals?: number
  /** Optional ticker override; defaults to the known-asset value when `assetId` is recognised. */
  ticker?: string
}

export type PreparePolkadotAssetSendResult = {
  chain: 'Polkadot'
  /** Routing discriminant for the downstream parser/signer — asset (pallet_assets) vs native (pallet_balances). */
  action: 'asset_transfer'
  assetId: number
  ticker?: string
  decimals?: number
  from: string
  to: string
  /** Recipient's 32-byte AccountId (decoded from the SS58 `to`), hex with `0x`. */
  toAccountId: string
  /** Amount in base units, decimal string. */
  amount: string
  /**
   * SCALE-encoded `pallet_assets.transferKeepAlive(id, target, amount)` call body, hex with `0x`.
   *
   * Layout: pallet(0x32) ‖ method(0x02) ‖ compact(assetId) ‖ MultiAddress::Id(0x00)
   *         ‖ AccountId32(32 bytes) ‖ compact(amount).
   *
   * This is the unsigned call body ONLY — no era/nonce/tip/signature framing. The
   * on-device signer wraps it into the full extrinsic and signs it. This builder
   * NEVER signs or broadcasts.
   */
  callHex: string
}

/**
 * Build the unsigned SCALE-encoded `pallet_assets.transferKeepAlive` call body
 * for a Polkadot Asset Hub token transfer (USDT asset_id=1984, USDC asset_id=1337),
 * from public inputs only.
 *
 * PURE CRYPTO — deterministic, offline, no RPC and no price resolution. It
 * produces the unsigned call body (`callHex`) the on-device signer wraps and
 * signs. It NEVER signs and NEVER broadcasts; key shares stay on-device.
 *
 * For native DOT use the native send path (`prepareSendTxFromKeys`) instead —
 * that routes through pallet_balances, not pallet_assets.
 *
 * Ported from the mcp-ts `build_polkadot_asset_send` tool, with the metadata-
 * resolved `api.tx.assets.transferKeepAlive(...)` call replaced by a deterministic
 * SCALE encode using the stable Asset Hub pallet/method indices (50/2) — the same
 * pair the downstream signer validates in `assertAssetTransferCallHex`.
 *
 * @example
 * ```ts
 * const tx = preparePolkadotAssetSend({
 *   assetId: 1984, // USDT
 *   from: '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp',
 *   to: '12gpf8 FaqdC1S2gQ...',
 *   amount: 1_000_000n, // 1 USDT (6 decimals)
 * })
 * // tx.callHex -> '0x3202d1051d00...'
 * ```
 */
export const preparePolkadotAssetSend = (params: PreparePolkadotAssetSendParams): PreparePolkadotAssetSendResult => {
  const { assetId, from, to, amount } = params

  if (!Number.isInteger(assetId) || assetId <= 0 || assetId > U32_MAX) {
    throw new Error(`Invalid Polkadot asset id ${assetId}: must be a positive integer u32 (max ${U32_MAX}).`)
  }
  if (amount <= 0n) {
    throw new Error('Amount must be greater than zero')
  }
  if (!from) {
    throw new Error('Sender address (from) is required')
  }

  // Decode the destination SS58 address to its 32-byte AccountId. decodeAddress
  // validates the SS58 checksum and rejects malformed addresses, so this also
  // serves as recipient validation.
  let toAccountId: Uint8Array
  try {
    toAccountId = decodeAddress(to)
  } catch (error) {
    throw new Error(
      `Invalid destination Polkadot address ${to}: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  if (toAccountId.length !== 32) {
    throw new Error(`Invalid destination Polkadot address ${to}: expected a 32-byte AccountId.`)
  }

  const knownAsset = POLKADOT_ASSET_HUB_KNOWN_ASSETS[assetId]
  const decimals = params.decimals ?? knownAsset?.decimals
  const ticker = params.ticker ?? knownAsset?.ticker

  // SCALE-encode pallet_assets.transferKeepAlive(id, target, amount):
  //   pallet_index(u8) ‖ method_index(u8)
  //   ‖ compact(id: u32)
  //   ‖ MultiAddress::Id discriminant (0x00) ‖ AccountId32 (32 bytes)
  //   ‖ compact(amount: u128)
  const callBody = u8aConcat(
    new Uint8Array([PALLET_ASSETS, METHOD_TRANSFER_KEEP_ALIVE]),
    compactToU8a(assetId),
    new Uint8Array([0x00]), // MultiAddress::Id
    toAccountId,
    compactToU8a(amount)
  )

  return {
    chain: 'Polkadot',
    action: 'asset_transfer',
    assetId,
    ticker,
    decimals,
    from,
    to,
    toAccountId: u8aToHex(toAccountId),
    amount: amount.toString(),
    callHex: u8aToHex(callBody),
  }
}
