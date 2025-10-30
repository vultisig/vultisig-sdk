/**
 * UTXO chain-specific types
 */

/**
 * Script types used by UTXO chains
 * - wpkh: Witness Pay-to-Public-Key-Hash (SegWit) - Bitcoin, Litecoin
 * - pkh: Pay-to-Public-Key-Hash (Legacy) - Bitcoin Cash, Dogecoin, Dash, Zcash
 */
export type UtxoScriptType = 'wpkh' | 'pkh'

/**
 * Configuration for a UTXO chain
 */
export interface UtxoChainConfig {
  /** Chain identifier */
  chain: string

  /** Script type for this chain */
  scriptType: UtxoScriptType

  /** Decimal places (typically 8 for UTXO chains) */
  decimals: number

  /** Token symbol */
  symbol: string

  /** Minimum dust threshold in base units (satoshis) */
  dustLimit: number

  /** Blockchair API chain name */
  blockchairName: string

  /** Special parameters for specific chains (e.g., Zcash branchId) */
  specialParams?: Record<string, any>
}

/**
 * Parsed PSBT transaction data
 */
export interface ParsedUtxoTransaction {
  /** PSBT base64 encoded string */
  psbtBase64: string

  /** Number of inputs */
  inputCount: number

  /** Number of outputs */
  outputCount: number

  /** Estimated fee in satoshis */
  fee?: number

  /** Transaction recipients */
  recipients?: Array<{
    address: string
    amount: string
  }>
}

/**
 * UTXO transaction input for keysign
 */
export interface UtxoInput {
  /** Transaction hash */
  hash: string

  /** Output index */
  index: number

  /** Amount in satoshis */
  amount: number
}
