import { fromBech32 } from '@cosmjs/encoding'

import { Chain } from '../../Chain'
import { getChainKind } from '../../ChainKind'
import { chainPrefixToChain } from '../../chains/cosmos/thor/lp/lpChainMap'
import { assertValidPoolId } from '../../chains/cosmos/thor/lp/pools'
import { baseAffiliateBps } from '../affiliate/config'
import { nativeSwapAffiliateConfig } from './nativeSwapAffiliateConfig'

export const limitSwapExpiryHours = [12, 24, 72] as const
export type LimitSwapExpiryHours = (typeof limitSwapExpiryHours)[number]

export type LimitSwapNumericInput = bigint | number | string

export type LimitSwapMemoInput = {
  source_asset: string
  source_amount: LimitSwapNumericInput
  target_asset: string
  dest_addr: string
  target_price: LimitSwapNumericInput
  expiry_hours: LimitSwapExpiryHours
}

export type LimitSwapSourceChainKind = 'utxo' | 'other'

export const limitSwapMemoByteLimit: Record<LimitSwapSourceChainKind, number> = {
  utxo: 80,
  other: 250,
}

const priceScale = 100_000_000n

const expiryHoursToIntervalBlocks: Record<LimitSwapExpiryHours, number> = {
  12: 7_200,
  24: 14_400,
  72: 43_200,
}

const assertMemoSegmentSafe = (value: string, fieldName: string): void => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`)
  }
  if (value.includes(':') || value.includes('/')) {
    throw new Error(`${fieldName} must not contain memo separators ":" or "/"`)
  }
  if (/\s/.test(value)) {
    throw new Error(`${fieldName} must not contain whitespace`)
  }
  if (!/^[\x21-\x7E]+$/.test(value)) {
    throw new Error(`${fieldName} must contain printable ASCII characters only`)
  }
}

const getAssetChainPrefix = (asset: string): string => {
  const [prefix] = asset.split('.')
  return prefix
}

const getSupportedThorchainAssetChain = (asset: string, fieldName: string): Chain => {
  assertValidPoolId(asset)

  const prefix = getAssetChainPrefix(asset)
  const chain = chainPrefixToChain(prefix)
  if (!chain) {
    throw new Error(`${fieldName} has unsupported THORChain asset prefix: ${prefix}`)
  }
  return chain
}

const parsePositiveInteger = (value: LimitSwapNumericInput, fieldName: string): bigint => {
  if (typeof value === 'bigint') {
    if (value > 0n) return value
    throw new Error(`${fieldName} must be greater than 0`)
  }

  if (typeof value === 'number') {
    if (Number.isSafeInteger(value) && value > 0) return BigInt(value)
    throw new Error(`${fieldName} must be a positive safe integer`)
  }

  const normalized = value.trim()
  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new Error(`${fieldName} must be a positive integer string`)
  }
  return BigInt(normalized)
}

const parsePositiveDecimal = (value: LimitSwapNumericInput, fieldName: string): bigint => {
  if (typeof value === 'bigint') {
    if (value > 0n) return value * priceScale
    throw new Error(`${fieldName} must be greater than 0`)
  }

  let normalized: string
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${fieldName} must be greater than 0`)
    }
    normalized = value.toString()
    if (normalized.includes('e')) {
      normalized = value.toFixed(8)
    }
    if (Number(normalized) !== value) {
      throw new Error(`${fieldName} must be a positive decimal with at most 8 fractional digits`)
    }
  } else {
    normalized = value.trim()
  }

  const match = normalized.match(/^(\d+)(?:\.(\d{1,8})?)?$/)
  if (!match) {
    throw new Error(`${fieldName} must be a positive decimal with at most 8 fractional digits`)
  }

  const [, whole, fractional = ''] = match
  const scaled = BigInt(whole) * priceScale + BigInt(fractional.padEnd(8, '0'))
  if (scaled <= 0n) {
    throw new Error(`${fieldName} must be greater than 0`)
  }
  return scaled
}

export const getLimitSwapSourceChainKind = (sourceAsset: string): LimitSwapSourceChainKind => {
  const chain = getSupportedThorchainAssetChain(sourceAsset, 'source_asset')
  return getChainKind(chain) === 'utxo' ? 'utxo' : 'other'
}

export const getLimitSwapIntervalBlocks = (expiryHours: LimitSwapExpiryHours): number => {
  const interval = expiryHoursToIntervalBlocks[expiryHours]
  if (!interval) {
    throw new Error(`expiry_hours must be one of ${limitSwapExpiryHours.join(', ')}, got ${expiryHours}`)
  }
  return interval
}

export const getLimitSwapLimitAmount = ({
  source_amount,
  target_price,
}: Pick<LimitSwapMemoInput, 'source_amount' | 'target_price'>): bigint => {
  const sourceAmount = parsePositiveInteger(source_amount, 'source_amount')
  const targetPrice = parsePositiveDecimal(target_price, 'target_price')

  return (sourceAmount * targetPrice) / priceScale
}

export const assertMemoByteLength = (memo: string, sourceChainKind: LimitSwapSourceChainKind): void => {
  const limit = limitSwapMemoByteLimit[sourceChainKind]
  if (!limit) {
    throw new Error(`Unknown source chain kind: ${sourceChainKind}`)
  }

  const byteLength = new TextEncoder().encode(memo).length
  if (byteLength > limit) {
    throw new Error(`THORChain limit swap memo is ${byteLength} bytes, exceeding ${sourceChainKind} limit ${limit}`)
  }
}

const base58AddressChars = '1-9A-HJ-NP-Za-km-z'

const isBech32Address = (address: string, prefix: string): boolean => {
  try {
    const decoded = fromBech32(address)
    return decoded.prefix === prefix && decoded.data.length > 0
  } catch {
    return false
  }
}

const isEvmAddress = (address: string): boolean => /^0x[0-9a-fA-F]{40}$/.test(address)

const limitSwapDestinationValidators: Partial<Record<Chain, (address: string) => boolean>> = {
  [Chain.Arbitrum]: isEvmAddress,
  [Chain.Avalanche]: isEvmAddress,
  [Chain.Base]: isEvmAddress,
  [Chain.BSC]: isEvmAddress,
  [Chain.Ethereum]: isEvmAddress,

  [Chain.Bitcoin]: address =>
    new RegExp(`^(bc1[ac-hj-np-z02-9]{11,71}|[13][${base58AddressChars}]{25,34})$`, 'i').test(address),
  [Chain.BitcoinCash]: address =>
    new RegExp(`^([qp][0-9a-z]{41}|[13][${base58AddressChars}]{25,34})$`, 'i').test(address),
  [Chain.Dash]: address => new RegExp(`^X[${base58AddressChars}]{33}$`).test(address),
  [Chain.Dogecoin]: address => new RegExp(`^D[5-9A-HJ-NP-U][${base58AddressChars}]{32}$`).test(address),
  [Chain.Litecoin]: address =>
    new RegExp(`^(ltc1[ac-hj-np-z02-9]{11,71}|[LM3][${base58AddressChars}]{25,34})$`, 'i').test(address),
  [Chain.Zcash]: address => new RegExp(`^t[13][${base58AddressChars}]{33}$`).test(address),

  [Chain.Cosmos]: address => isBech32Address(address, 'cosmos'),
  [Chain.Kujira]: address => isBech32Address(address, 'kujira'),
  [Chain.THORChain]: address => isBech32Address(address, 'thor'),

  [Chain.Ripple]: address => new RegExp(`^r[${base58AddressChars}]{24,34}$`).test(address),
  [Chain.Tron]: address => new RegExp(`^T[${base58AddressChars}]{33}$`).test(address),
}

const assertValidLimitSwapDestinationAddress = (targetChain: Chain, address: string): void => {
  const validator = limitSwapDestinationValidators[targetChain]
  if (!validator) {
    throw new Error(`target_asset chain ${targetChain} is not supported for limit swap destinations`)
  }
  if (!validator(address)) {
    throw new Error(`dest_addr is not a valid ${targetChain} address`)
  }
}

export const validateLimitSwapInputs = (inputs: LimitSwapMemoInput): void => {
  getSupportedThorchainAssetChain(inputs.source_asset, 'source_asset')
  const targetChain = getSupportedThorchainAssetChain(inputs.target_asset, 'target_asset')
  assertMemoSegmentSafe(inputs.dest_addr, 'dest_addr')
  assertValidLimitSwapDestinationAddress(targetChain, inputs.dest_addr)

  parsePositiveInteger(inputs.source_amount, 'source_amount')
  parsePositiveDecimal(inputs.target_price, 'target_price')
  getLimitSwapIntervalBlocks(inputs.expiry_hours)
}

const buildMemo = (inputs: LimitSwapMemoInput, includeAffiliate: boolean): string => {
  const limit = getLimitSwapLimitAmount(inputs)
  const interval = getLimitSwapIntervalBlocks(inputs.expiry_hours)
  const memo = `=<:${inputs.target_asset}:${inputs.dest_addr}:${limit}/${interval}/0`

  return includeAffiliate ? `${memo}:${nativeSwapAffiliateConfig.affiliateFeeAddress}:${baseAffiliateBps}` : memo
}

export const buildLimitSwapMemo = (inputs: LimitSwapMemoInput): string => {
  validateLimitSwapInputs(inputs)

  const sourceChainKind = getLimitSwapSourceChainKind(inputs.source_asset)
  const affiliateMemo = buildMemo(inputs, true)

  if (sourceChainKind === 'utxo') {
    try {
      assertMemoByteLength(affiliateMemo, sourceChainKind)
      return affiliateMemo
    } catch {
      const memoWithoutAffiliate = buildMemo(inputs, false)
      assertMemoByteLength(memoWithoutAffiliate, sourceChainKind)
      return memoWithoutAffiliate
    }
  }

  assertMemoByteLength(affiliateMemo, sourceChainKind)
  return affiliateMemo
}
