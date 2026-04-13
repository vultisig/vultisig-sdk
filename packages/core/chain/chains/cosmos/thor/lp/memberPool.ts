import type { RawMemberPool, ThorchainLpPosition } from './types'

export const isNonZeroBaseUnit = (value: string | undefined): boolean => {
  if (!value) return false
  try {
    return BigInt(value) > 0n
  } catch {
    return false
  }
}

export const normalizeMemberPool = (
  raw: RawMemberPool
): ThorchainLpPosition => ({
  pool: raw.pool ?? '',
  liquidityUnits: raw.liquidityUnits ?? '0',
  runeAdded: raw.runeAdded ?? '0',
  assetAdded: raw.assetAdded ?? '0',
  runePending: raw.runePending ?? '0',
  assetPending: raw.assetPending ?? '0',
  runeAddress: raw.runeAddress ?? '',
  assetAddress: raw.assetAddress ?? '',
  dateLastAdded: raw.dateLastAdded ?? '0',
  lastAddHeight: '',
  isPending:
    isNonZeroBaseUnit(raw.runePending) || isNonZeroBaseUnit(raw.assetPending),
})
