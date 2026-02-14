import { Asset } from './asset.js'
import { findAssetByFormat } from './registry.js'

/**
 * Convert asset to THORChain format
 */
export function toThorchainFormat(asset: Asset): string {
  return asset.formats.thorchain
}

/**
 * Convert asset to FIN format
 */
export function toFinFormat(asset: Asset): string {
  return asset.formats.fin
}

/**
 * Convert asset to L1/native format
 */
export function toL1Format(asset: Asset): string {
  return asset.formats.l1
}

/**
 * Parse asset identifier from any format
 */
export function parseAsset(input: string): Asset | null {
  return findAssetByFormat(input)
}

/**
 * Normalize THORChain pool name to standard format
 */
export function normalizeThorchainPool(pool: string): string {
  // Convert to uppercase and ensure proper format
  const upper = pool.toUpperCase()

  // Handle special cases
  if (upper === 'BTC.BTC') return 'BTC.BTC'
  if (upper === 'ETH.ETH') return 'ETH.ETH'
  if (upper === 'THOR.RUNE') return 'THOR.RUNE'

  // Handle ERC20 tokens - ensure contract address is uppercase
  if (upper.includes('-0X')) {
    const [chainSymbol, contract] = upper.split('-')
    return `${chainSymbol}-${contract}`
  }

  return upper
}

/**
 * Normalize FIN format to lowercase with hyphens
 */
export function normalizeFinFormat(format: string): string {
  return format.toLowerCase().replace(/[^a-z0-9-]/g, '-')
}

/**
 * Extract chain from THORChain format
 */
export function extractChainFromThorchain(thorchainFormat: string): string {
  const parts = thorchainFormat.split('.')
  if (parts.length < 2) {
    throw new Error(`Invalid THORChain format: ${thorchainFormat}`)
  }

  const chainMap: Record<string, string> = {
    BTC: 'bitcoin',
    ETH: 'ethereum',
    THOR: 'thorchain',
    AVAX: 'avalanche',
    GAIA: 'cosmos',
    DOGE: 'dogecoin',
    LTC: 'litecoin',
    BCH: 'bitcoincash',
    BNB: 'binance',
    BASE: 'base',
    XRP: 'xrp',
  }

  return chainMap[parts[0]] || parts[0].toLowerCase()
}

/**
 * Extract symbol from THORChain format
 */
export function extractSymbolFromThorchain(thorchainFormat: string): string {
  const parts = thorchainFormat.split('.')
  if (parts.length < 2) {
    throw new Error(`Invalid THORChain format: ${thorchainFormat}`)
  }

  // Handle contract addresses
  const symbolPart = parts[1]
  if (symbolPart.includes('-')) {
    return symbolPart.split('-')[0]
  }

  return symbolPart
}

/**
 * Extract contract from THORChain format (if present)
 */
export function extractContractFromThorchain(thorchainFormat: string): string | undefined {
  const parts = thorchainFormat.split('.')
  if (parts.length < 2) return undefined

  const symbolPart = parts[1]
  if (symbolPart.includes('-0X')) {
    return symbolPart.split('-')[1]
  }

  return undefined
}

/**
 * Build THORChain format from components
 */
export function buildThorchainFormat(chain: string, symbol: string, contract?: string): string {
  const chainPrefix = chain.toUpperCase()

  if (contract) {
    return `${chainPrefix}.${symbol.toUpperCase()}-${contract.toUpperCase()}`
  }

  return `${chainPrefix}.${symbol.toUpperCase()}`
}

/**
 * Build FIN format from components
 */
export function buildFinFormat(chain: string, symbol: string, contract?: string): string {
  let format = `${chain.toLowerCase()}-${symbol.toLowerCase()}`

  if (contract) {
    format += `-${contract.toLowerCase()}`
  }

  return format
}

/**
 * Convert between any two formats
 */
export function convertFormat(input: string, targetFormat: 'l1' | 'thorchain' | 'fin'): string | null {
  const asset = parseAsset(input)
  if (!asset) return null

  switch (targetFormat) {
    case 'l1':
      return toL1Format(asset)
    case 'thorchain':
      return toThorchainFormat(asset)
    case 'fin':
      return toFinFormat(asset)
    default:
      return null
  }
}

/**
 * Detect format type of input string
 */
export function detectFormat(input: string): 'l1' | 'thorchain' | 'fin' | 'unknown' {
  const normalized = input.toLowerCase()

  // FIN special formats first (before THORChain, since thor.xxx overlaps)
  // Test thor.xxx against original input so uppercase THOR.RUNE isn't matched
  if (/^x\/[a-z]+$/.test(normalized) || /^thor\.[a-z]+$/.test(input) || /^(rune|tcy)$/.test(normalized)) {
    return 'fin'
  }

  // THORChain format: CHAIN.SYMBOL or CHAIN.SYMBOL-CONTRACT
  if (/^[a-z]+\.[a-z]+(-.+)?$/i.test(input)) {
    return 'thorchain'
  }

  // FIN format: chain-symbol or chain-symbol-contract (chain is 2-5 chars)
  if (/^[a-z]{2,5}-[a-z0-9]+(-.+)?$/.test(normalized)) {
    return 'fin'
  }

  // L1 format: symbol or contract address
  if (/^0x[a-f0-9]{40}$/i.test(input) || /^[a-z]{2,5}$/i.test(input)) {
    return 'l1'
  }

  return 'unknown'
}
