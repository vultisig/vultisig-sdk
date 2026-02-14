import { Amount } from './amount.js'
import { Asset, Quote } from './asset.js'

/**
 * SwapRouter that selects the optimal path for swaps
 */
export class SwapRouter {
  /**
   * Auto-select best path and get quote
   *
   * Logic:
   * - If both assets are secured on THORChain → use Rujira FIN
   * - If swapping L1 to L1 → use THORChain LP
   */
  async quote(from: Asset, to: Asset, amount: Amount): Promise<Quote> {
    // Check if both assets are secured on THORChain
    const fromSecured = this.isSecuredOnThorchain(from)
    const toSecured = this.isSecuredOnThorchain(to)

    if (fromSecured && toSecured) {
      return this.quoteRujiraFIN(from, to, amount)
    } else {
      return this.quoteThorchainLP(from, to, amount)
    }
  }

  /**
   * Get quote from THORChain LP
   */
  async quoteThorchainLP(from: Asset, to: Asset, amount: Amount): Promise<Quote> {
    // Convert input to THORChain layer for calculation
    const thorchainAmount = amount.toThorchain()

    // Mock implementation - in real app, this would call THORChain APIs
    const mockRate = this.getMockRate(from, to)
    const outputRaw = (thorchainAmount.raw * BigInt(Math.floor(mockRate * 100))) / 100n

    const output = Amount.fromRaw(outputRaw, to, 'thorchain').toLayer(amount.layer)
    const minimumOutput = output.multiply(0.97) // 3% slippage tolerance

    // Mock fees
    const networkFee = Amount.fromRaw(1000000n, from, 'thorchain').toLayer(amount.layer)
    const protocolFee = amount.multiply(0.003) // 0.3% protocol fee

    return {
      path: 'thorchain-lp',
      input: amount,
      output,
      minimumOutput,
      priceImpact: '0.5%',
      fees: {
        network: networkFee,
        protocol: protocolFee,
      },
    }
  }

  /**
   * Get quote from Rujira FIN
   */
  async quoteRujiraFIN(from: Asset, to: Asset, amount: Amount): Promise<Quote> {
    // Convert input to FIN layer for calculation
    const finAmount = amount.toFin()

    // Mock implementation - in real app, this would call Rujira APIs
    const mockRate = this.getMockRate(from, to)
    const outputRaw = (finAmount.raw * BigInt(Math.floor(mockRate * 1000000))) / 1000000n

    const output = Amount.fromRaw(outputRaw, to, 'fin').toLayer(amount.layer)
    const minimumOutput = output.multiply(0.98) // 2% slippage tolerance (better on FIN)

    // Mock fees
    const networkFee = Amount.fromRaw(5000n, from, 'fin').toLayer(amount.layer)
    const protocolFee = amount.multiply(0.002) // 0.2% protocol fee (lower on FIN)

    return {
      path: 'rujira-fin',
      input: amount,
      output,
      minimumOutput,
      priceImpact: '0.3%',
      fees: {
        network: networkFee,
        protocol: protocolFee,
      },
    }
  }

  /**
   * Check if asset is secured on THORChain
   */
  private isSecuredOnThorchain(asset: Asset): boolean {
    // Assets that are secured (have significant liquidity) on THORChain
    const securedAssets = new Set(['btc', 'eth', 'rune', 'usdc', 'usdt', 'avax', 'atom'])

    return securedAssets.has(asset.id)
  }

  /**
   * Get mock exchange rate (in real app, would fetch from price feeds)
   */
  private getMockRate(from: Asset, to: Asset): number {
    // Mock rates - in production, fetch from price APIs
    const mockPrices: Record<string, number> = {
      btc: 45000,
      eth: 2500,
      rune: 5,
      usdc: 1,
      usdt: 1,
      avax: 35,
      atom: 10,
      doge: 0.08,
      ltc: 70,
      bch: 250,
      bnb: 300,
    }

    const fromPrice = mockPrices[from.id] || 1
    const toPrice = mockPrices[to.id] || 1

    return fromPrice / toPrice
  }

  /**
   * Get the recommended path for a swap
   */
  getRecommendedPath(from: Asset, to: Asset): 'thorchain-lp' | 'rujira-fin' {
    const fromSecured = this.isSecuredOnThorchain(from)
    const toSecured = this.isSecuredOnThorchain(to)

    return fromSecured && toSecured ? 'rujira-fin' : 'thorchain-lp'
  }

  /**
   * Check if a path is available for the given assets
   */
  isPathAvailable(from: Asset, to: Asset, path: 'thorchain-lp' | 'rujira-fin'): boolean {
    if (path === 'thorchain-lp') {
      // THORChain LP supports most assets
      return true
    }

    if (path === 'rujira-fin') {
      // FIN only supports secured assets
      return this.isSecuredOnThorchain(from) && this.isSecuredOnThorchain(to)
    }

    return false
  }

  /**
   * Get supported assets for a specific path
   */
  getSupportedAssets(path: 'thorchain-lp' | 'rujira-fin'): string[] {
    if (path === 'thorchain-lp') {
      // THORChain LP supports all known assets
      return ['btc', 'eth', 'rune', 'usdc', 'usdt', 'avax', 'atom', 'doge', 'ltc', 'bch', 'bnb']
    }

    if (path === 'rujira-fin') {
      // FIN only supports secured assets
      return ['btc', 'eth', 'rune', 'usdc', 'usdt', 'avax', 'atom']
    }

    return []
  }
}
