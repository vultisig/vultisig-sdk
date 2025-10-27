import { create } from '@bufbuild/protobuf'
import { base64 } from '@coral-xyz/anchor/dist/cjs/utils/bytes'
import { formatUnits } from 'ethers'

import { SolanaSpecificSchema } from '../../core/mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { CoinSchema } from '../../core/mpc/types/vultisig/keysign/v1/coin_pb'
import {
  KeysignPayload,
  KeysignPayloadSchema,
} from '../../core/mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { OneInchSwapPayloadSchema } from '../../core/mpc/types/vultisig/keysign/v1/1inch_swap_payload_pb'
import { ParsedSolanaTransaction, SolanaKeysignOptions } from './types'

/**
 * Build a Solana keysign payload from a parsed transaction
 *
 * This creates the MPC keysign payload that will be used for threshold signing.
 * It handles both transfers and swaps, encoding transaction data and metadata
 * into the protobuf format expected by the MPC signing flow.
 *
 * @param options - Configuration for building the keysign payload
 * @returns Keysign payload ready for MPC signing
 */
export async function buildSolanaKeysignPayload(
  options: SolanaKeysignOptions
): Promise<KeysignPayload> {
  const {
    parsedTransaction,
    serializedTransaction,
    vaultPublicKey,
    skipBroadcast = false,
  } = options

  // Encode serialized transaction as base64
  const txInputDataArray = Object.values(serializedTransaction)
  const txInputDataBuffer = new Uint8Array(txInputDataArray as any)
  const dataBuffer = Buffer.from(txInputDataBuffer)
  const base64Data = base64.encode(dataBuffer)

  // Determine if input token is native SOL
  const isNativeCoin = parsedTransaction.inputToken.symbol === 'SOL'

  // Create coin metadata for the input token
  const coin = create(CoinSchema, {
    chain: 'Solana', // This should match the Chain enum from the SDK
    ticker: parsedTransaction.inputToken.symbol.toUpperCase(),
    address: parsedTransaction.authority || '',
    decimals: parsedTransaction.inputToken.decimals,
    hexPublicKey: vaultPublicKey,
    logo: parsedTransaction.inputToken.symbol.toLowerCase(),
    priceProviderId: isNativeCoin ? 'solana' : undefined,
    contractAddress: isNativeCoin ? '' : parsedTransaction.inputToken.address,
    isNativeToken: isNativeCoin,
  })

  // Build Solana-specific blockchain data
  // This includes the recent block hash and priority fee for the transaction
  const solanaSpecific = create(SolanaSpecificSchema, {
    recentBlockHash: '', // Will be populated by the keysign flow
    priorityFee: '1000000', // Default priority fee in lamports
    fromTokenAssociatedAddress: undefined,
    toTokenAssociatedAddress: undefined,
    programId: undefined,
    computeLimit: undefined,
  })

  // Build swap payload if this is a swap transaction
  let swapPayload = null
  if (
    parsedTransaction.type === 'swap' &&
    parsedTransaction.outputToken &&
    parsedTransaction.outAmount
  ) {
    const isOutputNative = parsedTransaction.outputToken.symbol === 'SOL'

    swapPayload = create(OneInchSwapPayloadSchema, {
      fromCoin: {
        address: parsedTransaction.authority || '',
        chain: 'Solana',
        contractAddress: isNativeCoin
          ? ''
          : parsedTransaction.inputToken.address,
        decimals: parsedTransaction.inputToken.decimals,
        hexPublicKey: vaultPublicKey,
        priceProviderId: isNativeCoin ? 'solana' : undefined,
        logo: parsedTransaction.inputToken.symbol.toLowerCase(),
        isNativeToken: isNativeCoin,
        ticker: parsedTransaction.inputToken.symbol.toUpperCase(),
      },
      toCoin: {
        address: parsedTransaction.authority || '',
        chain: 'Solana',
        contractAddress: isOutputNative
          ? ''
          : parsedTransaction.outputToken.address,
        decimals: parsedTransaction.outputToken.decimals,
        hexPublicKey: vaultPublicKey,
        priceProviderId: isOutputNative ? 'solana' : undefined,
        logo: parsedTransaction.outputToken.symbol.toLowerCase(),
        isNativeToken: isOutputNative,
        ticker: parsedTransaction.outputToken.symbol.toUpperCase(),
      },
      fromAmount: String(parsedTransaction.inAmount),
      toAmountDecimal: formatUnits(
        parsedTransaction.outAmount,
        parsedTransaction.outputToken.decimals
      ),
      quote: {
        dstAmount: String(parsedTransaction.outAmount),
        tx: {
          data: base64Data,
          value: '0',
          gasPrice: '0',
          swapFee: '25000',
        },
      },
    })
  }

  // Build the final keysign payload
  const keysignPayload = create(KeysignPayloadSchema, {
    coin,
    toAddress: parsedTransaction.receiverAddress || '',
    toAmount: swapPayload
      ? swapPayload.quote?.dstAmount || ''
      : String(parsedTransaction.inAmount ?? 0),
    vaultPublicKeyEcdsa: vaultPublicKey,
    vaultLocalPartyId: '', // Will be set by the vault
    blockchainSpecific: {
      case: 'solanaSpecific',
      value: solanaSpecific,
    },
    swapPayload: swapPayload
      ? {
          case: 'oneinchSwapPayload',
          value: swapPayload,
        }
      : undefined,
    skipBroadcast,
  })

  return keysignPayload
}

/**
 * Extract Solana-specific data from a keysign payload
 * Utility function for accessing Solana blockchain-specific fields
 */
export function getSolanaSpecific(payload: KeysignPayload): typeof SolanaSpecificSchema | null {
  if (
    payload.blockchainSpecific?.case === 'solanaSpecific' &&
    payload.blockchainSpecific.value
  ) {
    return payload.blockchainSpecific.value as any
  }
  return null
}

/**
 * Update Solana-specific fields in a keysign payload
 * Useful for setting recent block hash and other chain-specific data
 */
export function updateSolanaSpecific(
  payload: KeysignPayload,
  updates: Partial<{
    recentBlockHash: string
    priorityFee: string
    fromTokenAssociatedAddress: string
    toTokenAssociatedAddress: string
    programId: boolean
    computeLimit: string
  }>
): KeysignPayload {
  const current = getSolanaSpecific(payload)
  if (!current) {
    throw new Error('Payload does not contain Solana-specific data')
  }

  return create(KeysignPayloadSchema, {
    ...payload,
    blockchainSpecific: {
      case: 'solanaSpecific',
      value: create(SolanaSpecificSchema, {
        ...current,
        ...updates,
      }),
    },
  })
}
