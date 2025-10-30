import { ChainStrategyFactory } from '../../chains/strategies/ChainStrategyFactory'
import { SigningPayload } from '../../types'
import { ParsedTransaction } from '../../chains/strategies/ChainStrategy'

/**
 * Service for coordinating transaction signing across chains.
 * Validates payloads and delegates to chain-specific strategies.
 */
export class SigningService {
  constructor(private strategyFactory: ChainStrategyFactory) {}

  /**
   * Parse a raw transaction for a specific chain
   * @param chain Chain identifier
   * @param rawTx Raw transaction data
   */
  async parseTransaction(chain: string, rawTx: any): Promise<ParsedTransaction> {
    const strategy = this.strategyFactory.getStrategy(chain)
    return strategy.parseTransaction(rawTx)
  }

  /**
   * Build keysign payload from parsed transaction
   * @param chain Chain identifier
   * @param tx Parsed transaction
   * @param vaultPublicKey Vault's public key
   * @param options Additional options
   */
  async buildKeysignPayload(
    chain: string,
    tx: ParsedTransaction,
    vaultPublicKey: string,
    options?: { skipBroadcast?: boolean }
  ): Promise<any> {
    const strategy = this.strategyFactory.getStrategy(chain)
    return strategy.buildKeysignPayload(tx, vaultPublicKey, options)
  }

  /**
   * Estimate gas for a transaction (if chain supports it)
   * @param chain Chain identifier
   * @param tx Transaction to estimate
   */
  async estimateGas(chain: string, tx: any): Promise<any> {
    const strategy = this.strategyFactory.getStrategy(chain)

    if (!strategy.estimateGas) {
      throw new Error(`Gas estimation not supported for chain: ${chain}`)
    }

    return strategy.estimateGas(tx)
  }

  /**
   * Validate signing payload
   * @param payload Signing payload to validate
   */
  validatePayload(payload: SigningPayload): void {
    if (!payload.transaction) {
      throw new Error('Missing transaction in payload')
    }
    if (!payload.chain) {
      throw new Error('Missing chain in payload')
    }
    if (!this.strategyFactory.isSupported(payload.chain)) {
      throw new Error(`Unsupported chain: ${payload.chain}`)
    }
  }
}
