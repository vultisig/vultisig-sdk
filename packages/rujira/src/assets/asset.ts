/**
 * Asset interface representing a digital asset with multi-layer support
 */
export type Asset = {
  id: string // 'btc', 'usdc', etc
  name: string // 'Bitcoin', 'USD Coin'
  chain: string // 'bitcoin', 'ethereum', 'thorchain'
  contract?: string // ERC20 contract address if applicable
  decimals: {
    native: number // Native chain decimals (BTC=8, ETH=18, USDC=6)
    thorchain: number // Always 8 (THORChain storage)
    fin: number // FIN contract precision (usually 6)
  }
  formats: {
    l1: string // Native format (address or symbol)
    thorchain: string // 'CHAIN.SYMBOL' or 'CHAIN.SYMBOL-CONTRACT'
    fin: string // 'chain-symbol' lowercase with hyphens
  }
}

/**
 * Layer types supported by the assets package
 */
export type Layer = 'native' | 'thorchain' | 'fin'

/**
 * Quote interface for swap operations
 */
export type Quote = {
  path: 'thorchain-lp' | 'rujira-fin'
  input: Amount
  output: Amount
  minimumOutput: Amount
  priceImpact: string
  fees: {
    network: Amount
    protocol: Amount
  }
}

// Forward declaration for Amount (will be defined in amount.ts)
export type Amount = {
  readonly asset: Asset
  readonly layer: Layer
  readonly raw: bigint
}
