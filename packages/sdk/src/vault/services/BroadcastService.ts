import { Chain } from '@core/chain/Chain'
import { getTwPublicKeyType } from '@core/chain/publicKey/tw/getTwPublicKeyType'
import { decodeSigningOutput } from '@core/chain/tw/signingOutput'
import { broadcastTx as coreBroadcastTx } from '@core/chain/tx/broadcast'
import { compileTx } from '@core/chain/tx/compile/compileTx'
import { getTxHash } from '@core/chain/tx/hash'
import { getEncodedSigningInputs } from '@core/mpc/keysign/signingInputs'
import { getKeysignTwPublicKey } from '@core/mpc/keysign/tw/getKeysignTwPublicKey'
import { KeysignPayload } from '@core/mpc/types/vultisig/keysign/v1/keysign_message_pb'

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
  async broadcastTx(params: { chain: Chain; keysignPayload: KeysignPayload; signature: Signature }): Promise<string> {
    const { chain, keysignPayload, signature } = params

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
      const publicKey = walletCore.PublicKey.createWithData(publicKeyData, publicKeyType)

      // Get transaction input data (same data used during signing)
      const txInputsArray = getEncodedSigningInputs({
        keysignPayload,
        walletCore,
        publicKey,
      })

      // Most chains have single tx input; UTXO may have multiple
      // For now, handle the common case (single input)
      if (txInputsArray.length === 0) {
        throw new Error('No transaction inputs found in keysign payload')
      }
      const txInputData = txInputsArray[0]

      // Compile transaction (combines signatures with tx data)
      const compiledTx = compileTx({
        publicKey,
        txInputData,
        signatures: keysignSignatures,
        chain,
        walletCore,
      })

      // Decode compiled bytes to SigningOutput
      const signingOutput = decodeSigningOutput(chain, compiledTx)

      // Broadcast transaction to network
      await coreBroadcastTx({
        chain,
        tx: signingOutput,
      })

      // Extract transaction hash from signing output
      const txHash = await getTxHash({ chain, tx: signingOutput })

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
