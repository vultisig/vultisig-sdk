import { Chain } from '@vultisig/core-chain/Chain'
import { getCoinType } from '@vultisig/core-chain/coin/coinType'
import { getTwPublicKeyType } from '@vultisig/core-chain/publicKey/tw/getTwPublicKeyType'
import { decodeSigningOutput } from '@vultisig/core-chain/tw/signingOutput'
import { broadcastTx as coreBroadcastTx } from '@vultisig/core-chain/tx/broadcast'
import { getTxHash } from '@vultisig/core-chain/tx/hash'
import { getEncodedSigningInputs } from '@vultisig/core-mpc/keysign/signingInputs'
import { getKeysignTwPublicKey } from '@vultisig/core-mpc/keysign/tw/getKeysignTwPublicKey'
import { compileTx } from '@vultisig/core-mpc/tx/compile/compileTx'
import { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'

import type { WasmProvider } from '../../context/SdkContext'
import type { Signature } from '../../types'
import { convertToKeysignSignatures } from '../utils/convertSignature'
import { VaultError, VaultErrorCode } from '../VaultError'

/**
 * BroadcastService
 *
 * Handles transaction broadcasting to blockchain networks.
 * Extracted from Vault.ts to reduce file size and improve maintainability.
 *
 * This service:
 * - Converts SDK signatures to core KeysignSignature format
 * - Compiles transactions with signatures
 * - Broadcasts transactions to the network
 * - Extracts transaction hashes from signing outputs
 */
export interface CompiledTxResult {
  /** Raw signed transaction bytes (base58-encoded string from SigningOutput) */
  signingOutput: any
  /** Transaction hash */
  txHash: string
}

export class BroadcastService {
  constructor(
    private extractMessageHashes: (keysignPayload: KeysignPayload) => Promise<string[]>,
    private wasmProvider: WasmProvider
  ) {}

  /**
   * Broadcast a signed transaction to the blockchain network
   *
   * This method compiles the signed transaction and broadcasts it to the network.
   * It should be called after prepareSendTx() and sign().
   *
   * @param params - Broadcast parameters
   * @param params.chain - The blockchain to broadcast on
   * @param params.keysignPayload - Original payload from prepareSendTx()
   * @param params.signature - Signature from sign()
   *
   * @returns Transaction hash (string) on success
   *
   * @throws {VaultError} With code BroadcastFailed if broadcast fails
   *
   * @example
   * ```typescript
   * const txHash = await broadcastService.broadcastTx({
   *   chain: Chain.Ethereum,
   *   keysignPayload: payload,
   *   signature
   * })
   * console.log(`Transaction: ${txHash}`)
   * ```
   */
  /**
   * Compile signed transactions without broadcasting.
   * Used by JITO bundle flow to get raw signed tx bytes before bundling.
   */
  async compileTxOnly(params: { chain: Chain; keysignPayload: KeysignPayload; signature: Signature }): Promise<CompiledTxResult[]> {
    const { chain, keysignPayload, signature } = params
    const walletCore = await this.wasmProvider.getWalletCore()
    const messageHashes = await this.extractMessageHashes(keysignPayload)
    const keysignSignatures = convertToKeysignSignatures(signature, messageHashes)
    const publicKeyData = getKeysignTwPublicKey(keysignPayload)
    const publicKeyType = getTwPublicKeyType({ walletCore, chain })
    const coinType = getCoinType({ walletCore, chain })
    const keyType = coinType === walletCore.CoinType.tron
      ? walletCore.PublicKeyType.secp256k1Extended
      : publicKeyType
    const publicKey = walletCore.PublicKey.createWithData(publicKeyData, keyType)

    const txInputsArray = getEncodedSigningInputs({ keysignPayload, walletCore, publicKey })
    if (txInputsArray.length === 0) {
      throw new Error('No transaction inputs found in keysign payload')
    }

    const results: CompiledTxResult[] = []
    for (const txInputData of txInputsArray) {
      const compiled = compileTx({ publicKey, txInputData, signatures: keysignSignatures, chain, walletCore })
      const signingOutput = decodeSigningOutput(chain, compiled)
      const txHash = await getTxHash({ chain, tx: signingOutput })
      results.push({ signingOutput, txHash })
    }
    return results
  }

  async broadcastTx(params: { chain: Chain; keysignPayload: KeysignPayload; signature: Signature; broadcastHint?: string }): Promise<string> {
    const { chain, keysignPayload, signature, broadcastHint } = params

    try {
      // Get WalletCore instance via WasmProvider
      const walletCore = await this.wasmProvider.getWalletCore()

      // Extract message hashes from payload
      const messageHashes = await this.extractMessageHashes(keysignPayload)

      // Convert SDK Signature to KeysignSignature format
      const keysignSignatures = convertToKeysignSignatures(signature, messageHashes)

      // Get public key from keysign payload
      const publicKeyData = getKeysignTwPublicKey(keysignPayload)
      const publicKeyType = getTwPublicKeyType({ walletCore, chain })
      // Tron stores uncompressed public key (65 bytes), so use secp256k1Extended type
      const coinType = getCoinType({ walletCore, chain })
      const keyType = coinType === walletCore.CoinType.tron
        ? walletCore.PublicKeyType.secp256k1Extended
        : publicKeyType
      const publicKey = walletCore.PublicKey.createWithData(publicKeyData, keyType)

      // Get transaction input data (same data used during signing)
      const txInputsArray = getEncodedSigningInputs({
        keysignPayload,
        walletCore,
        publicKey,
      })

      if (txInputsArray.length === 0) {
        throw new Error('No transaction inputs found in keysign payload')
      }

      // Broadcast all transaction inputs (e.g., approve + swap for EVM token flows).
      // Returns the hash of the last transaction, which is typically the primary one.
      let txHash = ''
      for (const txInputData of txInputsArray) {
        const compiledTx = compileTx({
          publicKey,
          txInputData,
          signatures: keysignSignatures,
          chain,
          walletCore,
        })

        const signingOutput = decodeSigningOutput(chain, compiledTx)

        await coreBroadcastTx({
          chain,
          tx: signingOutput,
          broadcastHint,
        })

        txHash = await getTxHash({ chain, tx: signingOutput })
      }

      return txHash
    } catch (error) {
      throw new VaultError(
        VaultErrorCode.BroadcastFailed,
        `Failed to broadcast transaction on ${chain}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : new Error(String(error))
      )
    }
  }
}
