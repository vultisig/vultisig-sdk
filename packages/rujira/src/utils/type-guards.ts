import type { Asset } from '../assets/index.js'

/**
 * Type guard to check if an object is a valid Asset with a secured FIN denom.
 * Secured assets follow the `chain-symbol` pattern (e.g., `btc-btc`, `eth-usdc-0xa0b8...`).
 * Native tokens (`rune`, `tcy`) and module tokens (`x/ruji`) are excluded.
 * @internal
 */
export function isFinAsset(obj: unknown): obj is Asset & { formats: { fin: string } } {
  if (!obj || typeof obj !== 'object') return false
  const asset = obj as Partial<Asset>
  return (
    typeof asset.formats === 'object' &&
    asset.formats !== null &&
    typeof asset.formats.fin === 'string' &&
    asset.formats.fin.includes('-')
  )
}

/**
 * Parse a THORChain asset string into chain and symbol components.
 * @param asset - Asset string (e.g., "BTC.BTC", "ETH.USDC-0xA0b8...")
 * @internal
 */
export function parseAsset(asset: string): { chain: string; symbol: string } {
  const parts = asset.split('.')
  return {
    chain: parts[0]?.toUpperCase() || '',
    symbol: parts.slice(1).join('.') || '',
  }
}
