import { stripHexPrefix } from '@vultisig/lib-utils/hex/stripHexPrefix'

/** Minimal shape of a native-token holding, as returned by Koios. */
export type CardanoNativeAsset = {
  policy_id: string
  asset_name: string
  quantity: string
}

const hexToBytes = (hex: string): Uint8Array =>
  Uint8Array.from(Buffer.from(stripHexPrefix(hex), 'hex'))

/**
 * Build the in-memory tree representing a Cardano `value` per the CDDL:
 *
 *     value = coin / [coin, multiasset<uint>]
 *     multiasset<a> = { * policy_id => { * asset_name => a } }
 *
 * The returned structure is fed to the shared `cardanoCborEncoder`; when
 * the UTXO carries no native tokens the result is the lovelace uint itself.
 * Duplicated (policy, asset_name) entries are summed.
 */
export const buildCardanoValue = (
  lovelace: bigint,
  assets: readonly CardanoNativeAsset[]
): bigint | [bigint, Map<Uint8Array, Map<Uint8Array, bigint>>] => {
  if (assets.length === 0) return lovelace

  type Bucket = {
    policy: Uint8Array
    byName: Map<string, { name: Uint8Array; qty: bigint }>
  }
  const byPolicy = new Map<string, Bucket>()

  for (const a of assets) {
    const policyKey = a.policy_id.toLowerCase()
    let bucket = byPolicy.get(policyKey)
    if (!bucket) {
      bucket = { policy: hexToBytes(a.policy_id), byName: new Map() }
      byPolicy.set(policyKey, bucket)
    }
    const nameKey = a.asset_name.toLowerCase()
    const prior = bucket.byName.get(nameKey)
    bucket.byName.set(nameKey, {
      name: hexToBytes(a.asset_name),
      qty: (prior?.qty ?? 0n) + BigInt(a.quantity),
    })
  }

  const multiasset = new Map<Uint8Array, Map<Uint8Array, bigint>>()
  for (const { policy, byName } of byPolicy.values()) {
    const inner = new Map<Uint8Array, bigint>()
    for (const { name, qty } of byName.values()) inner.set(name, qty)
    multiasset.set(policy, inner)
  }
  return [lovelace, multiasset]
}
