/**
 * Cardano native tokens are identified by `policy_id.asset_name` (both hex-encoded).
 * This module provides helpers to parse and construct that compound ID.
 */

type CardanoAssetIdParts = {
  policyId: string
  assetName: string
}

const separator = '.'

/** Constructs a Cardano asset ID from policy ID and asset name. */
export const toCardanoAssetId = ({
  policyId,
  assetName,
}: CardanoAssetIdParts): string =>
  `${policyId}${separator}${assetName}`

/** Splits a Cardano asset ID into policy ID and asset name. */
export const fromCardanoAssetId = (id: string): CardanoAssetIdParts => {
  const dotIndex = id.indexOf(separator)
  if (dotIndex === -1) {
    throw new Error(`Invalid Cardano asset ID (missing separator): ${id}`)
  }

  return {
    policyId: id.slice(0, dotIndex),
    assetName: id.slice(dotIndex + 1),
  }
}
