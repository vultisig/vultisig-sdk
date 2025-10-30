/**
 * UTXO Chain Strategy
 * Supports Bitcoin, Bitcoin Cash, Litecoin, Dogecoin, Dash, and Zcash
 */

export { UtxoStrategy } from './UtxoStrategy'
export {
  type UtxoScriptType,
  type UtxoChainConfig,
  type ParsedUtxoTransaction,
  type UtxoInput,
} from './types'
export {
  UTXO_CHAIN_CONFIGS,
  getUtxoChainConfig,
  isUtxoChain,
  getSupportedUtxoChains,
} from './config'
