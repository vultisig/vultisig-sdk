import { Chain } from '@vultisig/core-chain/Chain'
import { getCoinType } from '@vultisig/core-chain/coin/coinType'
import { getTwPublicKeyType } from '@vultisig/core-chain/publicKey/tw/getTwPublicKeyType'
import { decodeSigningOutput } from '@vultisig/core-chain/tw/signingOutput'
import { type BroadcastStrategyInput, broadcastTx as coreBroadcastTx } from '@vultisig/core-chain/tx/broadcast'
import { getTxHash } from '@vultisig/core-chain/tx/hash'
import { getTxStatus } from '@vultisig/core-chain/tx/status'
import { getEncodedSigningInputs } from '@vultisig/core-mpc/keysign/signingInputs'
import { assertNativeSwapReadyForBroadcast } from '@vultisig/core-mpc/keysign/swap/assertNativeSwapReadyForBroadcast'
import { getKeysignTwPublicKey } from '@vultisig/core-mpc/keysign/tw/getKeysignTwPublicKey'
import { compileTx } from '@vultisig/core-mpc/tx/compile/compileTx'
import { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'

import type { WasmProvider } from '../../context/SdkContext'
import type { Signature } from '../../types'
import { convertToKeysignSignatures } from '../utils/convertSignature'
import { VaultError, VaultErrorCode } from '../VaultError'

type BroadcastPartialFailureInput = {
  chain: Chain
  broadcastedTxHashes: string[]
  failedInputIndex: number
  cause: unknown
}

type ApprovalConfirmationOptions = {
  approvalConfirmationTimeoutMs?: number
  approvalConfirmationIntervalMs?: number
}

export class BroadcastPartialFailureError extends Error {
  readonly broadcastedTxHashes: string[]
  readonly failedInputIndex: number
  readonly originalError?: Error

  constructor({ chain, broadcastedTxHashes, failedInputIndex, cause }: BroadcastPartialFailureInput) {
    const errorMessage = cause instanceof Error ? cause.message : String(cause)
    super(
      `Broadcast failed on ${chain} input ${failedInputIndex + 1} after ${
        broadcastedTxHashes.length
      } transaction(s) were submitted: ${errorMessage}. Broadcasted transaction hashes: ${broadcastedTxHashes.join(
        ', '
      )}`
    )
    this.name = 'BroadcastPartialFailureError'
    this.broadcastedTxHashes = broadcastedTxHashes
    this.failedInputIndex = failedInputIndex
    this.originalError = cause instanceof Error ? cause : new Error(String(cause))
  }
}

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
  private readonly broadcastTransaction: typeof coreBroadcastTx
  private readonly confirmationOptions: ApprovalConfirmationOptions

  constructor(
    private extractMessageHashes: (keysignPayload: KeysignPayload) => Promise<string[]>,
    private wasmProvider: WasmProvider,
    broadcastTransactionOrConfirmationOptions: typeof coreBroadcastTx | ApprovalConfirmationOptions = coreBroadcastTx,
    confirmationOptions: ApprovalConfirmationOptions = {}
  ) {
    if (typeof broadcastTransactionOrConfirmationOptions === 'function') {
      this.broadcastTransaction = broadcastTransactionOrConfirmationOptions
      this.confirmationOptions = confirmationOptions
    } else {
      this.broadcastTransaction = coreBroadcastTx
      this.confirmationOptions = broadcastTransactionOrConfirmationOptions
    }
  }

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
  async broadcastTx(
    params: BroadcastStrategyInput & {
      keysignPayload: KeysignPayload
      signature: Signature
    }
  ): Promise<string> {
    const { chain, keysignPayload, signature, strategy } = params

    try {
      await assertNativeSwapReadyForBroadcast({ chain, keysignPayload })

      // Get WalletCore instance via WasmProvider
      const walletCore = await this.wasmProvider.getWalletCore()

      // Extract message hashes from payload
      const messageHashes = await this.extractMessageHashes(keysignPayload)

      // Convert SDK Signature to KeysignSignature format
      const keysignSignatures = convertToKeysignSignatures(signature, messageHashes)

      // QBTC uses MLDSA — WalletCore public keys are not applicable.
      // getEncodedSigningInputs and compileTx both have dedicated QBTC branches
      // that skip WalletCore entirely.
      const isQbtc = chain === Chain.QBTC

      let publicKey: import('@trustwallet/wallet-core/dist/src/wallet-core').PublicKey | undefined
      if (!isQbtc) {
        const publicKeyData = getKeysignTwPublicKey(keysignPayload)
        const publicKeyType = getTwPublicKeyType({ walletCore, chain })
        const coinType = getCoinType({ walletCore, chain })
        const keyType =
          coinType === walletCore.CoinType.tron ? walletCore.PublicKeyType.secp256k1Extended : publicKeyType
        publicKey = walletCore.PublicKey.createWithData(publicKeyData, keyType)
      }

      // Get transaction input data (same data used during signing)
      const txInputsArray = await getEncodedSigningInputs({
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
      const shouldConfirmApprovalFirst = !!keysignPayload.erc20ApprovePayload && txInputsArray.length > 1
      const broadcastedTxHashes: string[] = []
      for (const [index, txInputData] of txInputsArray.entries()) {
        const compiledTx = compileTx({
          publicKey,
          txInputData,
          signatures: keysignSignatures,
          chain,
          walletCore,
          // Required for payload-keyed compile branches (signSolana raw
          // transactions splice the signature into the original bytes,
          // sdk#1204 — matches the keysignPayload extractMessageHashes
          // already passes to getPreSigningHashes).
          keysignPayload,
        })

        const signingOutput = decodeSigningOutput(chain, compiledTx)
        let broadcastResult: Awaited<ReturnType<typeof coreBroadcastTx>>
        try {
          broadcastResult = await this.broadcastTransaction({ chain, tx: signingOutput, strategy })
        } catch (error) {
          if (broadcastedTxHashes.length > 0) {
            throw new BroadcastPartialFailureError({
              chain,
              broadcastedTxHashes,
              failedInputIndex: index,
              cause: error,
            })
          }
          throw error
        }

        if (broadcastResult.status === 'failed') {
          const cause =
            broadcastResult.cause instanceof Error ? broadcastResult.cause : new Error(String(broadcastResult.cause))
          const error = new Error(
            `${broadcastResult.code} (retryable=${broadcastResult.retryable}): ${cause.message}`,
            {
              cause,
            }
          )
          if (broadcastedTxHashes.length > 0) {
            throw new BroadcastPartialFailureError({
              chain,
              broadcastedTxHashes,
              failedInputIndex: index,
              cause: error,
            })
          }
          throw error
        }

        const inputTxHash = broadcastResult.txHash ?? (await getTxHash({ chain, tx: signingOutput }))
        broadcastedTxHashes.push(inputTxHash)
        txHash = inputTxHash

        if (shouldConfirmApprovalFirst && index === 0) {
          try {
            await this.waitForConfirmation(chain, txHash)
          } catch (error) {
            throw new BroadcastPartialFailureError({
              chain,
              broadcastedTxHashes,
              failedInputIndex: index,
              cause: error,
            })
          }
        }
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

  private async waitForConfirmation(chain: Chain, txHash: string): Promise<void> {
    const timeoutMs = this.confirmationOptions.approvalConfirmationTimeoutMs ?? 60_000
    const intervalMs = this.confirmationOptions.approvalConfirmationIntervalMs ?? 3_000
    const deadline = Date.now() + timeoutMs
    let lastError: unknown

    while (Date.now() <= deadline) {
      const requestBudgetMs = deadline - Date.now()
      if (requestBudgetMs <= 0) break

      let requestTimeout: number | ReturnType<typeof setTimeout> | undefined
      const result = await Promise.race([
        getTxStatus({ chain, hash: txHash }).catch(error => {
          lastError = error
          return undefined
        }),
        new Promise<undefined>(resolve => {
          requestTimeout = setTimeout(resolve, requestBudgetMs)
        }),
      ]).finally(() => {
        if (requestTimeout) clearTimeout(requestTimeout)
      })

      if (result?.status === 'success') return
      if (result?.status === 'error') {
        throw new Error(`Approval tx failed: ${txHash}`)
      }

      const remainingMs = deadline - Date.now()
      if (remainingMs <= 0) break

      await new Promise(resolve => setTimeout(resolve, Math.min(intervalMs, remainingMs)))
    }

    const suffix = lastError instanceof Error ? ` Last status error: ${lastError.message}` : ''
    throw new Error(`Approval tx not confirmed within ${timeoutMs / 1000}s: ${txHash}.${suffix}`)
  }
}
