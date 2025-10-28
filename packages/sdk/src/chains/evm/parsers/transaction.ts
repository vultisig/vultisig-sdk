/**
 * EVM transaction parser
 *
 * Handles parsing of RLP-encoded EVM transactions including:
 * - Legacy transactions (type 0)
 * - EIP-2930 transactions (type 1)
 * - EIP-1559 transactions (type 2)
 */

import { TW, WalletCore } from '@trustwallet/wallet-core'
import { decodeRlp, toBeHex, getBytes } from 'ethers'

import type {
  ParsedEvmTransaction,
  EvmTransactionInput,
  EvmTransactionType,
} from '../types'
import { ERC20_SELECTORS, ERC721_SELECTORS, ERC1155_SELECTORS } from '../config'

// Helper function for ethers compatibility
function toHex(value: any): string {
  return toBeHex(value)
}

function hexToBytes(hex: string): Uint8Array {
  return getBytes(hex)
}

/**
 * Parse an EVM transaction from raw bytes or hex string
 *
 * Decodes the transaction and identifies its type (transfer, swap, NFT, etc.)
 * Routes to appropriate protocol parsers for detailed parsing.
 *
 * @param walletCore - WalletCore instance for transaction decoding
 * @param rawTx - Raw transaction as hex string or Uint8Array
 * @returns Parsed transaction with all decoded fields
 */
export async function parseEvmTransaction(
  walletCore: WalletCore,
  rawTx: EvmTransactionInput
): Promise<ParsedEvmTransaction> {
  // Convert to Uint8Array if needed
  let txBytes: Uint8Array
  if (typeof rawTx === 'string') {
    const hex = rawTx.startsWith('0x') ? rawTx.slice(2) : rawTx
    txBytes = hexToBytes(`0x${hex}`)
  } else {
    txBytes = rawTx
  }

  // Decode RLP-encoded transaction
  const decoded = decodeTransaction(txBytes)

  // Identify transaction type based on recipient and data
  const type = identifyTransactionType(decoded.to, decoded.data)

  // Build base parsed transaction
  const parsed: ParsedEvmTransaction = {
    type,
    from: decoded.from,
    to: decoded.to,
    value: decoded.value,
    data: decoded.data,
    nonce: decoded.nonce,
    chainId: decoded.chainId,
    gasLimit: decoded.gasLimit,
    maxFeePerGas: decoded.maxFeePerGas,
    maxPriorityFeePerGas: decoded.maxPriorityFeePerGas,
    gasPrice: decoded.gasPrice,
    accessList: decoded.accessList,
  }

  // Parse type-specific details
  if (type === 'transfer' && decoded.data.length > 2) {
    // ERC-20 transfer
    parsed.transfer = parseErc20TransferData(decoded.to, decoded.data, decoded.from)
  } else if (type === 'transfer' && decoded.value > 0n) {
    // Native token transfer
    parsed.transfer = {
      amount: decoded.value,
      recipient: decoded.to,
      sender: decoded.from,
    }
  } else if (type === 'approve') {
    // ERC-20 approve
    parsed.approve = parseErc20ApproveData(decoded.to, decoded.data)
  } else if (type === 'nft') {
    // NFT transfer
    parsed.nft = parseNftTransferData(decoded.to, decoded.data, decoded.from)
  } else if (type === 'swap') {
    // Swap detection - will be enhanced by protocol parsers in Phase 3
    parsed.decoded = {
      functionName: 'swap',
      functionSignature: '',
      functionSelector: decoded.data.slice(0, 10),
      functionArgs: {},
    }
  } else if (type === 'contract') {
    // Generic contract interaction
    parsed.decoded = {
      functionName: 'unknown',
      functionSignature: '',
      functionSelector: decoded.data.slice(0, 10),
      functionArgs: {},
    }
  }

  return parsed
}

/**
 * Decode RLP-encoded transaction bytes
 */
function decodeTransaction(txBytes: Uint8Array): {
  from: string
  to: string
  value: bigint
  data: string
  nonce: number
  chainId: number
  gasLimit: bigint
  maxFeePerGas?: bigint
  maxPriorityFeePerGas?: bigint
  gasPrice?: bigint
  accessList?: Array<{ address: string; storageKeys: string[] }>
} {
  // Check transaction type from first byte
  const firstByte = txBytes[0]

  let txType = 0 // Legacy by default
  let rlpData = txBytes

  // EIP-2718 typed transactions
  if (firstByte === 0x01) {
    txType = 1 // EIP-2930
    rlpData = txBytes.slice(1)
  } else if (firstByte === 0x02) {
    txType = 2 // EIP-1559
    rlpData = txBytes.slice(1)
  } else if (firstByte >= 0xc0) {
    txType = 0 // Legacy
  }

  // Decode RLP
  const decoded = decodeRlp(rlpData)

  if (txType === 2) {
    // EIP-1559 transaction
    // [chainId, nonce, maxPriorityFeePerGas, maxFeePerGas, gasLimit, to, value, data, accessList, signatureYParity, signatureR, signatureS]
    return {
      chainId: Number(decoded[0]),
      nonce: Number(decoded[1]),
      maxPriorityFeePerGas: BigInt(decoded[2]),
      maxFeePerGas: BigInt(decoded[3]),
      gasLimit: BigInt(decoded[4]),
      to: toHex(decoded[5]),
      value: BigInt(decoded[6]),
      data: toHex(decoded[7]),
      accessList: parseAccessList(decoded[8]),
      from: '', // Will be recovered from signature if needed
    }
  } else if (txType === 1) {
    // EIP-2930 transaction
    // [chainId, nonce, gasPrice, gasLimit, to, value, data, accessList, signatureYParity, signatureR, signatureS]
    return {
      chainId: Number(decoded[0]),
      nonce: Number(decoded[1]),
      gasPrice: BigInt(decoded[2]),
      gasLimit: BigInt(decoded[3]),
      to: toHex(decoded[4]),
      value: BigInt(decoded[5]),
      data: toHex(decoded[6]),
      accessList: parseAccessList(decoded[7]),
      from: '', // Will be recovered from signature if needed
    }
  } else {
    // Legacy transaction
    // [nonce, gasPrice, gasLimit, to, value, data, v, r, s]
    const chainId = decoded[6] ? Number(decoded[6]) : 1 // Extract from v if present
    return {
      chainId,
      nonce: Number(decoded[0]),
      gasPrice: BigInt(decoded[1]),
      gasLimit: BigInt(decoded[2]),
      to: toHex(decoded[3]),
      value: BigInt(decoded[4]),
      data: toHex(decoded[5]),
      from: '', // Will be recovered from signature if needed
    }
  }
}

/**
 * Parse access list from RLP decoded data
 */
function parseAccessList(
  accessListRaw: any
): Array<{ address: string; storageKeys: string[] }> | undefined {
  if (!accessListRaw || !Array.isArray(accessListRaw)) {
    return undefined
  }

  return accessListRaw.map((item) => ({
    address: toHex(item[0]),
    storageKeys: item[1].map((key: any) => toHex(key)),
  }))
}

/**
 * Identify transaction type based on recipient and data
 */
function identifyTransactionType(to: string, data: string): EvmTransactionType {
  if (!data || data === '0x' || data.length <= 2) {
    // No data = simple transfer
    return 'transfer'
  }

  // Extract function selector (first 4 bytes)
  const selector = data.slice(0, 10).toLowerCase()

  // Check ERC-20 selectors
  if (selector === ERC20_SELECTORS.TRANSFER) {
    return 'transfer'
  }
  if (selector === ERC20_SELECTORS.APPROVE) {
    return 'approve'
  }
  if (selector === ERC20_SELECTORS.TRANSFER_FROM) {
    return 'transfer'
  }

  // Check NFT selectors
  if (
    selector === ERC721_SELECTORS.TRANSFER_FROM ||
    selector === ERC721_SELECTORS.SAFE_TRANSFER_FROM ||
    selector === ERC721_SELECTORS.SAFE_TRANSFER_FROM_DATA
  ) {
    return 'nft'
  }
  if (
    selector === ERC1155_SELECTORS.SAFE_TRANSFER_FROM ||
    selector === ERC1155_SELECTORS.SAFE_BATCH_TRANSFER
  ) {
    return 'nft'
  }

  // Check for swap patterns (will be enhanced by protocol parsers in Phase 3)
  // Common swap function selectors include:
  // - swapExactTokensForTokens
  // - swapTokensForExactTokens
  // - swap (1inch)
  // - execute (1inch)
  if (
    selector === '0x38ed1739' || // swapExactTokensForTokens
    selector === '0x8803dbee' || // swapTokensForExactTokens
    selector === '0x12aa3caf' || // 1inch swap
    selector === '0xe449022e' || // 1inch unoswap
    selector === '0x0502b1c5'    // 1inch unoswapTo
  ) {
    return 'swap'
  }

  // Default to generic contract interaction
  return 'contract'
}

/**
 * Parse ERC-20 transfer calldata
 */
function parseErc20TransferData(
  tokenAddress: string,
  data: string,
  from: string
): ParsedEvmTransaction['transfer'] {
  // transfer(address,uint256) = 0xa9059cbb
  // Data format: 0xa9059cbb + 32 bytes recipient + 32 bytes amount

  if (data.length < 74) {
    throw new Error('Invalid ERC-20 transfer data')
  }

  const recipient = `0x${data.slice(34, 74).padStart(40, '0')}`
  const amountHex = data.slice(74, 138)
  const amount = BigInt(`0x${amountHex}`)

  return {
    token: {
      address: tokenAddress,
      name: '', // Will be fetched separately if needed
      symbol: '',
      decimals: 18, // Default, should be fetched
      chainId: 0, // Will be set by caller
    },
    amount,
    recipient,
    sender: from,
  }
}

/**
 * Parse ERC-20 approve calldata
 */
function parseErc20ApproveData(
  tokenAddress: string,
  data: string
): ParsedEvmTransaction['approve'] {
  // approve(address,uint256) = 0x095ea7b3
  // Data format: 0x095ea7b3 + 32 bytes spender + 32 bytes amount

  if (data.length < 74) {
    throw new Error('Invalid ERC-20 approve data')
  }

  const spender = `0x${data.slice(34, 74).padStart(40, '0')}`
  const amountHex = data.slice(74, 138)
  const amount = BigInt(`0x${amountHex}`)

  return {
    token: {
      address: tokenAddress,
      name: '',
      symbol: '',
      decimals: 18,
      chainId: 0,
    },
    spender,
    amount,
  }
}

/**
 * Parse NFT transfer calldata
 */
function parseNftTransferData(
  contractAddress: string,
  data: string,
  defaultFrom: string
): ParsedEvmTransaction['nft'] {
  const selector = data.slice(0, 10).toLowerCase()

  // transferFrom(address,address,uint256) = 0x23b872dd
  // safeTransferFrom(address,address,uint256) = 0x42842e0e
  if (
    selector === ERC721_SELECTORS.TRANSFER_FROM ||
    selector === ERC721_SELECTORS.SAFE_TRANSFER_FROM
  ) {
    if (data.length < 138) {
      throw new Error('Invalid ERC-721 transfer data')
    }

    const from = `0x${data.slice(34, 74).padStart(40, '0')}`
    const to = `0x${data.slice(98, 138).padStart(40, '0')}`
    const tokenIdHex = data.slice(138, 202)
    const tokenId = BigInt(`0x${tokenIdHex}`).toString()

    return {
      contractAddress,
      tokenId,
      amount: 1n,
      from,
      to,
      standard: 'ERC-721',
    }
  }

  // safeTransferFrom(address,address,uint256,uint256,bytes) for ERC-1155
  if (selector === ERC1155_SELECTORS.SAFE_TRANSFER_FROM) {
    if (data.length < 202) {
      throw new Error('Invalid ERC-1155 transfer data')
    }

    const from = `0x${data.slice(34, 74).padStart(40, '0')}`
    const to = `0x${data.slice(98, 138).padStart(40, '0')}`
    const tokenIdHex = data.slice(138, 202)
    const tokenId = BigInt(`0x${tokenIdHex}`).toString()
    const amountHex = data.slice(202, 266)
    const amount = BigInt(`0x${amountHex}`)

    return {
      contractAddress,
      tokenId,
      amount,
      from,
      to,
      standard: 'ERC-1155',
    }
  }

  // Fallback
  return {
    contractAddress,
    tokenId: '0',
    amount: 1n,
    from: defaultFrom,
    to: contractAddress,
    standard: 'ERC-721',
  }
}

/**
 * Parse ERC-20 transferFrom calldata
 */
export function parseErc20TransferFrom(data: string): {
  from: string
  to: string
  amount: bigint
} {
  // transferFrom(address,address,uint256) = 0x23b872dd
  if (data.length < 138) {
    throw new Error('Invalid ERC-20 transferFrom data')
  }

  const from = `0x${data.slice(34, 74).padStart(40, '0')}`
  const to = `0x${data.slice(98, 138).padStart(40, '0')}`
  const amountHex = data.slice(138, 202)
  const amount = BigInt(`0x${amountHex}`)

  return { from, to, amount }
}

/**
 * Extract function selector from calldata
 */
export function getFunctionSelector(data: string): string {
  if (!data || data.length < 10) {
    return '0x'
  }
  return data.slice(0, 10).toLowerCase()
}
