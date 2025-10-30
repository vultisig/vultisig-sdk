/**
 * EVM keysign payload builders
 *
 * Functions for building MPC keysign payloads from parsed EVM transactions.
 * Handles native transfers, ERC-20 tokens, swaps, and contract interactions.
 */

import { create } from '@bufbuild/protobuf'
import { formatUnits } from 'ethers'

import { EthereumSpecificSchema } from '@core/mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { CoinSchema } from '@core/mpc/types/vultisig/keysign/v1/coin_pb'
import {
  KeysignPayload,
  KeysignPayloadSchema,
} from '@core/mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { OneInchSwapPayloadSchema } from '@core/mpc/types/vultisig/keysign/v1/1inch_swap_payload_pb'

import { EvmKeysignOptions, EvmTransactionInput, ParsedEvmTransaction } from './types'
import { isNativeToken } from './config'
import { getChainFromId } from './config'

/**
 * Build an EVM keysign payload from a parsed transaction
 *
 * This creates the MPC keysign payload that will be used for threshold signing.
 * It handles native transfers, ERC-20 transfers, swaps, and contract interactions,
 * encoding transaction data and metadata into the protobuf format expected by the
 * MPC signing flow.
 *
 * @param options - Configuration for building the keysign payload
 * @returns Keysign payload ready for MPC signing
 */
export async function buildEvmKeysignPayload(
  options: EvmKeysignOptions
): Promise<KeysignPayload> {
  const {
    parsedTransaction,
    rawTransaction,
    vaultPublicKey,
    skipBroadcast = false,
    memo,
  } = options

  // Convert raw transaction to hex string if needed
  const txHex = typeof rawTransaction === 'string'
    ? rawTransaction.startsWith('0x') ? rawTransaction : `0x${rawTransaction}`
    : `0x${Buffer.from(rawTransaction).toString('hex')}`

  // Determine chain name from chain ID
  const chainEnum = getChainFromId(parsedTransaction.chainId)
  const chainName = chainEnum || 'Ethereum'

  // Determine if this is a native token transaction
  let isNativeCoin = false
  let ticker = 'ETH'
  let decimals = 18
  let contractAddress = ''
  let priceProviderId = ''

  if (parsedTransaction.type === 'transfer' && parsedTransaction.transfer) {
    const { token } = parsedTransaction.transfer
    if (token) {
      // ERC-20 transfer
      isNativeCoin = false
      ticker = token.symbol.toUpperCase()
      decimals = token.decimals
      contractAddress = token.address
    } else {
      // Native token transfer
      isNativeCoin = true
      ticker = getNativeTokenSymbol(chainName)
      decimals = 18
      contractAddress = ''
      priceProviderId = getNativeTokenPriceId(chainName)
    }
  } else if (parsedTransaction.type === 'swap' && parsedTransaction.swap) {
    // For swaps, use input token
    const { inputToken } = parsedTransaction.swap
    isNativeCoin = isNativeToken(inputToken.address)
    ticker = inputToken.symbol.toUpperCase()
    decimals = inputToken.decimals
    contractAddress = isNativeCoin ? '' : inputToken.address
    priceProviderId = isNativeCoin ? getNativeTokenPriceId(chainName) : ''
  } else {
    // Default to native token for other transaction types
    isNativeCoin = true
    ticker = getNativeTokenSymbol(chainName)
    decimals = 18
    contractAddress = ''
    priceProviderId = getNativeTokenPriceId(chainName)
  }

  // Create coin metadata
  const coin = create(CoinSchema, {
    chain: chainName,
    ticker,
    address: parsedTransaction.from,
    decimals,
    hexPublicKey: vaultPublicKey,
    logo: ticker.toLowerCase(),
    priceProviderId: priceProviderId || undefined,
    contractAddress,
    isNativeToken: isNativeCoin,
  })

  // Build Ethereum-specific blockchain data
  const ethereumSpecific = create(EthereumSpecificSchema, {
    nonce: BigInt(parsedTransaction.nonce),
    maxFeePerGasWei: parsedTransaction.maxFeePerGas?.toString() || '0',
    priorityFee: parsedTransaction.maxPriorityFeePerGas?.toString() || '0',
    gasLimit: parsedTransaction.gasLimit.toString(),
  })

  // Determine recipient and amount
  let toAddress = parsedTransaction.to
  let toAmount = '0'

  if (parsedTransaction.type === 'transfer' && parsedTransaction.transfer) {
    toAddress = parsedTransaction.transfer.recipient
    toAmount = parsedTransaction.transfer.amount.toString()
  } else if (parsedTransaction.type === 'swap' && parsedTransaction.swap) {
    toAddress = parsedTransaction.swap.recipient || parsedTransaction.to
    toAmount = parsedTransaction.swap.inputAmount.toString()
  } else {
    toAmount = parsedTransaction.value.toString()
  }

  // Build swap payload if this is a swap transaction
  let swapPayload = null
  if (parsedTransaction.type === 'swap' && parsedTransaction.swap) {
    const swap = parsedTransaction.swap
    const isInputNative = isNativeToken(swap.inputToken.address)
    const isOutputNative = isNativeToken(swap.outputToken.address)

    swapPayload = create(OneInchSwapPayloadSchema, {
      fromCoin: {
        address: parsedTransaction.from,
        chain: chainName,
        contractAddress: isInputNative ? '' : swap.inputToken.address,
        decimals: swap.inputToken.decimals,
        hexPublicKey: vaultPublicKey,
        priceProviderId: isInputNative ? getNativeTokenPriceId(chainName) : undefined,
        logo: swap.inputToken.symbol.toLowerCase(),
        isNativeToken: isInputNative,
        ticker: swap.inputToken.symbol.toUpperCase(),
      },
      toCoin: {
        address: parsedTransaction.from,
        chain: chainName,
        contractAddress: isOutputNative ? '' : swap.outputToken.address,
        decimals: swap.outputToken.decimals,
        hexPublicKey: vaultPublicKey,
        priceProviderId: isOutputNative ? getNativeTokenPriceId(chainName) : undefined,
        logo: swap.outputToken.symbol.toLowerCase(),
        isNativeToken: isOutputNative,
        ticker: swap.outputToken.symbol.toUpperCase(),
      },
      fromAmount: swap.inputAmount.toString(),
      toAmountDecimal: formatUnits(swap.outputAmount, swap.outputToken.decimals),
      quote: {
        dstAmount: swap.outputAmount.toString(),
        tx: {
          data: txHex,
          value: parsedTransaction.value.toString(),
          gasPrice: parsedTransaction.gasPrice?.toString() || '0',
          // Note: Swap fee is protocol-specific, defaulting to 0 for now
          swapFee: '0',
        },
      },
    })
  }

  // Build the final keysign payload
  const keysignPayload = create(KeysignPayloadSchema, {
    coin,
    toAddress,
    toAmount: swapPayload
      ? swapPayload.quote?.dstAmount || toAmount
      : toAmount,
    vaultPublicKeyEcdsa: vaultPublicKey,
    vaultLocalPartyId: '', // Will be set by the vault
    blockchainSpecific: {
      case: 'ethereumSpecific',
      value: ethereumSpecific,
    },
    swapPayload: swapPayload
      ? {
          case: 'oneinchSwapPayload',
          value: swapPayload,
        }
      : undefined,
    memo: memo || undefined,
    skipBroadcast,
  })

  return keysignPayload
}

/**
 * Extract Ethereum-specific data from a keysign payload
 * Utility function for accessing EVM blockchain-specific fields
 *
 * @param payload - Keysign payload to extract from
 * @returns Ethereum-specific data or null if not found
 */
export function getEvmSpecific(
  payload: KeysignPayload
) {
  if (
    payload.blockchainSpecific?.case === 'ethereumSpecific' &&
    payload.blockchainSpecific.value
  ) {
    return payload.blockchainSpecific.value
  }
  return null
}

/**
 * Update Ethereum-specific fields in a keysign payload
 * Useful for adjusting gas parameters or nonce
 *
 * @param payload - Original keysign payload
 * @param updates - Fields to update
 * @returns Updated keysign payload
 */
export function updateEvmSpecific(
  payload: KeysignPayload,
  updates: Partial<{
    nonce: string | bigint
    maxFeePerGasWei: string
    priorityFee: string
    gasLimit: string
  }>
): KeysignPayload {
  const current = getEvmSpecific(payload)
  if (!current) {
    throw new Error('Payload does not contain Ethereum-specific data')
  }

  // Convert nonce to bigint if it's provided as a string
  const processedUpdates = {
    ...updates,
    ...(updates.nonce !== undefined && {
      nonce: typeof updates.nonce === 'string' ? BigInt(updates.nonce) : updates.nonce,
    }),
  }

  return create(KeysignPayloadSchema, {
    ...payload,
    blockchainSpecific: {
      case: 'ethereumSpecific',
      value: create(EthereumSpecificSchema, {
        ...current,
        ...processedUpdates,
      }),
    },
  })
}

/**
 * Helper: Get native token symbol for a chain
 */
function getNativeTokenSymbol(chain: string): string {
  const symbols: Record<string, string> = {
    Ethereum: 'ETH',
    Arbitrum: 'ETH',
    Base: 'ETH',
    Blast: 'ETH',
    Optimism: 'ETH',
    Zksync: 'ETH',
    Mantle: 'MNT',
    Polygon: 'MATIC',
    Avalanche: 'AVAX',
    BSC: 'BNB',
    CronosChain: 'CRO',
  }
  return symbols[chain] || 'ETH'
}

/**
 * Helper: Get price provider ID for native token
 */
function getNativeTokenPriceId(chain: string): string {
  const ids: Record<string, string> = {
    Ethereum: 'ethereum',
    Arbitrum: 'ethereum',
    Base: 'ethereum',
    Blast: 'ethereum',
    Optimism: 'ethereum',
    Zksync: 'ethereum',
    Mantle: 'mantle',
    Polygon: 'matic-network',
    Avalanche: 'avalanche-2',
    BSC: 'binancecoin',
    CronosChain: 'crypto-com-chain',
  }
  return ids[chain] || 'ethereum'
}
