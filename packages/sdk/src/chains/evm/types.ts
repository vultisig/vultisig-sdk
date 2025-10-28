/**
 * EVM chain type definitions for transaction parsing and signing
 *
 * These types support:
 * - Native ETH/EVM token transfers
 * - ERC-20 token transfers
 * - Uniswap V2/V3 swaps
 * - 1inch aggregator swaps
 * - NFT transfers (ERC-721, ERC-1155)
 * - Generic contract interactions
 * - EIP-1559 transactions (type 2)
 * - Legacy transactions (type 0)
 * - Access list transactions (EIP-2930, type 1)
 */

/**
 * Token representation for EVM tokens (native and ERC-20)
 * Compatible with standard token list formats
 */
export interface EvmToken {
  /** Token contract address (0xeeee...eeee for native token) */
  address: string
  /** Token name (e.g., "Ethereum", "USD Coin") */
  name: string
  /** Token symbol (e.g., "ETH", "USDC") */
  symbol: string
  /** Number of decimal places */
  decimals: number
  /** Chain ID where the token exists */
  chainId: number
  /** Optional logo URI */
  logoURI?: string
}

/**
 * Transaction type identifier for EVM transactions
 */
export type EvmTransactionType =
  | 'transfer'      // Native token or ERC-20 transfer
  | 'swap'          // DEX swap (Uniswap, 1inch, etc.)
  | 'nft'           // NFT transfer (ERC-721, ERC-1155)
  | 'contract'      // Generic contract interaction
  | 'approve'       // ERC-20 approve
  | 'unknown'       // Unrecognized transaction

/**
 * Protocol identifier for recognized DEX protocols
 */
export type EvmProtocol =
  | 'uniswap-v2'
  | 'uniswap-v3'
  | '1inch'
  | 'erc20'
  | 'erc721'
  | 'erc1155'
  | 'unknown'

/**
 * Decoded contract call information
 */
export interface DecodedContractCall {
  /** Contract function name */
  functionName: string
  /** Function signature (e.g., "transfer(address,uint256)") */
  functionSignature: string
  /** 4-byte function selector */
  functionSelector: string
  /** Decoded function arguments */
  functionArgs: Record<string, any>
  /** Protocol identifier if recognized */
  protocol?: EvmProtocol
}

/**
 * Transfer-specific transaction data
 */
export interface EvmTransferParams {
  /** Token being transferred (undefined for native token) */
  token?: EvmToken
  /** Transfer amount in smallest unit (wei for native) */
  amount: bigint
  /** Recipient address */
  recipient: string
  /** Sender address */
  sender: string
}

/**
 * Swap-specific transaction data
 */
export interface EvmSwapParams {
  /** Input token being sold */
  inputToken: EvmToken
  /** Output token being bought */
  outputToken: EvmToken
  /** Input amount in token's smallest unit */
  inputAmount: bigint
  /** Output amount in token's smallest unit */
  outputAmount: bigint
  /** Minimum output amount (slippage protection) */
  minOutputAmount?: bigint
  /** Protocol used for the swap */
  protocol: string
  /** Swap recipient address */
  recipient?: string
  /** Swap deadline timestamp */
  deadline?: number
}

/**
 * NFT transfer-specific transaction data
 */
export interface EvmNftParams {
  /** NFT contract address */
  contractAddress: string
  /** Token ID being transferred */
  tokenId: string
  /** Amount (1 for ERC-721, can be >1 for ERC-1155) */
  amount: bigint
  /** Sender address */
  from: string
  /** Recipient address */
  to: string
  /** NFT standard */
  standard: 'ERC-721' | 'ERC-1155'
}

/**
 * ERC-20 approve-specific transaction data
 */
export interface EvmApproveParams {
  /** Token being approved */
  token: EvmToken
  /** Spender address being approved */
  spender: string
  /** Approved amount in token's smallest unit */
  amount: bigint
}

/**
 * Parsed EVM transaction with decoded fields
 * Result of parsing any supported EVM transaction type
 */
export interface ParsedEvmTransaction {
  /** Transaction type identifier */
  type: EvmTransactionType

  // Core transaction fields
  /** Sender address */
  from: string
  /** Recipient address (contract or EOA) */
  to: string
  /** Native token value in wei */
  value: bigint
  /** Transaction data (calldata) */
  data: string
  /** Transaction nonce */
  nonce: number
  /** Chain ID */
  chainId: number

  // Gas fields
  /** Gas limit */
  gasLimit: bigint
  /** Max fee per gas (EIP-1559, in wei) */
  maxFeePerGas?: bigint
  /** Max priority fee per gas (EIP-1559, in wei) */
  maxPriorityFeePerGas?: bigint
  /** Gas price (legacy transactions, in wei) */
  gasPrice?: bigint

  // Optional access list (EIP-2930)
  /** Access list for EIP-2930 transactions */
  accessList?: Array<{
    address: string
    storageKeys: string[]
  }>

  // Parsed details (populated based on transaction type)
  /** Decoded contract call information */
  decoded?: DecodedContractCall

  // Type-specific parsed data
  /** Transfer details (if type is 'transfer') */
  transfer?: EvmTransferParams
  /** Swap details (if type is 'swap') */
  swap?: EvmSwapParams
  /** NFT details (if type is 'nft') */
  nft?: EvmNftParams
  /** Approve details (if type is 'approve') */
  approve?: EvmApproveParams
}

/**
 * EVM transaction input format
 * Can be hex string or Uint8Array
 */
export type EvmTransactionInput =
  | string         // Hex-encoded transaction (with or without 0x prefix)
  | Uint8Array     // Raw transaction bytes

/**
 * Keysign payload builder options for EVM
 */
export interface EvmKeysignOptions {
  /** Parsed transaction data */
  parsedTransaction: ParsedEvmTransaction
  /** Original raw transaction (hex string or bytes) */
  rawTransaction: EvmTransactionInput
  /** Vault public key (ECDSA) */
  vaultPublicKey: string
  /** Whether to skip broadcasting after signing */
  skipBroadcast?: boolean
  /** Optional memo/note for the transaction */
  memo?: string
}

/**
 * EVM signing result
 */
export interface EvmSignature {
  /** DER-encoded signature */
  signature: string
  /** Signature r value */
  r: string
  /** Signature s value */
  s: string
  /** Signature v value (recovery ID) */
  v: number
  /** Transaction hash (if broadcasted) */
  txHash?: string
  /** Signed transaction hex (if not broadcasted) */
  signedTransaction?: string
}

/**
 * Gas estimation result
 */
export interface EvmGasEstimate {
  /** Base fee per gas (in wei) */
  baseFeePerGas: bigint
  /** Max priority fee per gas (in wei) */
  maxPriorityFeePerGas: bigint
  /** Max fee per gas (in wei) */
  maxFeePerGas: bigint
  /** Estimated gas limit */
  gasLimit: bigint
  /** Estimated total cost (gasLimit * maxFeePerGas, in wei) */
  totalCost: bigint
}

/**
 * Formatted gas price in multiple units
 */
export interface FormattedGasPrice {
  /** Price in wei */
  wei: string
  /** Price in gwei */
  gwei: string
  /** Price in eth */
  eth: string
}
