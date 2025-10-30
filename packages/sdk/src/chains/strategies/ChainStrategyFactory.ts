import { ChainStrategy } from './ChainStrategy'
import { ChainConfig } from '../config/ChainConfig'
import { WASMManager } from '../../wasm/WASMManager'

/**
 * Factory for chain strategies.
 * Manages registration and lookup of chain-specific implementations.
 */
export class ChainStrategyFactory {
  private strategies = new Map<string, ChainStrategy>()

  /**
   * Register a chain strategy
   * @param chainId Chain identifier (e.g., 'Ethereum', 'Solana')
   * @param strategy Strategy implementation
   */
  register(chainId: string, strategy: ChainStrategy): void {
    this.strategies.set(chainId, strategy)
  }

  /**
   * Get strategy for a chain
   * @param chainId Chain identifier
   * @throws Error if chain not supported
   */
  getStrategy(chainId: string): ChainStrategy {
    const strategy = this.strategies.get(chainId)
    if (!strategy) {
      const supported = Array.from(this.strategies.keys()).join(', ')
      throw new Error(
        `Unsupported chain: ${chainId}. Supported chains: ${supported}`
      )
    }
    return strategy
  }

  /**
   * Check if a chain is supported
   * @param chainId Chain identifier
   */
  isSupported(chainId: string): boolean {
    return this.strategies.has(chainId)
  }

  /**
   * Get all supported chain identifiers
   */
  getSupportedChains(): string[] {
    return Array.from(this.strategies.keys())
  }

  /**
   * Register all EVM chains with a single strategy instance per chain
   * @param evmChains List of EVM chain identifiers
   * @param strategyFactory Factory function to create strategy for each chain
   */
  registerEvmChains(
    evmChains: string[],
    strategyFactory: (chainId: string) => ChainStrategy
  ): void {
    for (const chainId of evmChains) {
      this.register(chainId, strategyFactory(chainId))
    }
  }

  /**
   * Register all UTXO chains with a single strategy instance per chain
   * @param utxoChains List of UTXO chain identifiers
   * @param strategyFactory Factory function to create strategy for each chain
   */
  registerUtxoChains(
    utxoChains: string[],
    strategyFactory: (chainId: string) => ChainStrategy
  ): void {
    for (const chainId of utxoChains) {
      this.register(chainId, strategyFactory(chainId))
    }
  }
}

/**
 * Create a default factory with all supported chains registered
 * Uses ChainConfig to get chain lists (single source of truth)
 * @param wasmManager WASMManager instance to inject into strategies
 */
export function createDefaultStrategyFactory(wasmManager: WASMManager): ChainStrategyFactory {
  const factory = new ChainStrategyFactory()

  // Get chain lists from ChainConfig (no more hardcoded lists!)
  const evmChains = ChainConfig.getEvmChains()
  const utxoChains = ChainConfig.getUtxoChains()

  // Import strategy classes (dynamic to avoid circular deps)
  const { EvmStrategy } = require('../evm/EvmStrategy')
  const { SolanaStrategy } = require('../solana/SolanaStrategy')
  const { UtxoStrategy } = require('../utxo/UtxoStrategy')

  // Register all EVM chains (they share same strategy with different config)
  factory.registerEvmChains(evmChains, (chainId) => new EvmStrategy(chainId, wasmManager))

  // Register all UTXO chains (they share same strategy with different config)
  factory.registerUtxoChains(utxoChains, (chainId) => new UtxoStrategy(chainId, wasmManager))

  // Register Solana
  factory.register('Solana', new SolanaStrategy(wasmManager))

  return factory
}
