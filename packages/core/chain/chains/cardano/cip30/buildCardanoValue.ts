import { stripHexPrefix } from '@vultisig/lib-utils/hex/stripHexPrefix'

/** Minimal shape of a native-token holding, as returned by Koios. */
export type CardanoNativeAsset = {
  policy_id: string
  asset_name: string
  quantity: string
}

const hexPattern = /^[0-9a-fA-F]*$/

const hexToBytes = (hex: string): Uint8Array =>
  Uint8Array.from(Buffer.from(stripHexPrefix(hex), 'hex'))

const assertEvenHex = (field: string, value: string) => {
  const stripped = stripHexPrefix(value)
  if (stripped.length === 0 || stripped.length % 2 !== 0 || !hexPattern.test(stripped)) {
    throw new Error(
      `buildCardanoValue: ${field} must be non-empty even-length hex, got ${JSON.stringify(value)}`
    )
  }
}

const assertNonNegativeQuantity = (value: string) => {
  const parsed = attemptBigInt(value)
  if (parsed === null || parsed < 0n) {
    throw new Error(
      `buildCardanoValue: quantity must be a non-negative integer, got ${JSON.stringify(value)}`
    )
  }
  return parsed
}

const attemptBigInt = (value: string): bigint | null => {
  try {
    return BigInt(value)
  } catch {
    return null
  }
}

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
    assertEvenHex('policy_id', a.policy_id)
    // asset_name may legitimately be empty (per-policy "default" asset), so
    // only validate the hex shape when a name is provided.
    if (a.asset_name.length > 0) {
      const stripped = stripHexPrefix(a.asset_name)
      if (stripped.length % 2 !== 0 || !hexPattern.test(stripped)) {
        throw new Error(
          `buildCardanoValue: asset_name must be even-length hex, got ${JSON.stringify(a.asset_name)}`
        )
      }
    }
    const quantity = assertNonNegativeQuantity(a.quantity)

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
      qty: (prior?.qty ?? 0n) + quantity,
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
