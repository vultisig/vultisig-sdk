import { AccountCoin } from '@core/chain/coin/AccountCoin'
import { getPublicKey } from '@core/chain/publicKey/getPublicKey'
import { getTwPublicKeyType } from '@core/chain/publicKey/tw/getTwPublicKeyType'
import { getPreSigningHashes } from '@core/chain/tx/preSigningHashes'
import { isValidAddress } from '@core/chain/utils/isValidAddress'
import { FeeSettings } from '@core/mpc/keysign/chainSpecific/FeeSettings'
import { buildSendKeysignPayload } from '@core/mpc/keysign/send/build'
import { getEncodedSigningInputs } from '@core/mpc/keysign/signingInputs'
import { getKeysignTwPublicKey } from '@core/mpc/keysign/tw/getKeysignTwPublicKey'
import { getKeysignChain } from '@core/mpc/keysign/utils/getKeysignChain'
import { KeysignPayload } from '@core/mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { Vault as CoreVault } from '@core/mpc/vault/Vault'

import type { WasmProvider } from '../../context/SdkContext'
import { VaultError, VaultErrorCode } from '../VaultError'

/**
 * TransactionBuilder Service
 *
 * Handles transaction preparation and message hash extraction.
 * Extracted from Vault.ts to reduce file size and improve maintainability.
 */
export class TransactionBuilder {
  constructor(
    private vaultData: CoreVault,
    private wasmProvider: WasmProvider
  ) {}

  /**
   * Prepare a send transaction keysign payload
   *
   * This method builds a complete keysign payload for sending tokens or native coins.
   * The returned `KeysignPayload` can be passed directly to the `sign()` method.
   *
   * @param params - Transaction parameters
   * @param params.coin - The coin to send (AccountCoin with chain, address, decimals, ticker, and optional id for tokens)
   * @param params.receiver - The recipient's address
   * @param params.amount - Amount to send in base units (as bigint)
   * @param params.memo - Optional transaction memo (for chains that support it)
   * @param params.feeSettings - Optional custom fee settings (FeeSettings - chain-specific)
   *
   * @returns A KeysignPayload ready to be signed with the sign() method
   *
   * @example
   * ```typescript
   * // Prepare a native coin transfer
   * const payload = await transactionBuilder.prepareSendTx({
   *   coin: {
   *     chain: Chain.Ethereum,
   *     address: await vault.address('ethereum'),
   *     decimals: 18,
   *     ticker: 'ETH'
   *   },
   *   receiver: '0x...',
   *   amount: 1500000000000000000n // 1.5 ETH
   * })
   * ```
   */
  async prepareSendTx(params: {
    coin: AccountCoin
    receiver: string
    amount: bigint
    memo?: string
    feeSettings?: FeeSettings
  }): Promise<KeysignPayload> {
    try {
      // Get WalletCore via WasmProvider
      const walletCore = await this.wasmProvider.getWalletCore()

      // Validate receiver address format
      const isValid = isValidAddress({
        chain: params.coin.chain,
        address: params.receiver,
        walletCore,
      })
      if (!isValid) {
        throw new VaultError(
          VaultErrorCode.InvalidConfig,
          `Invalid receiver address format for chain ${params.coin.chain}: ${params.receiver}`
        )
      }

      // Get public key for the coin's chain
      const publicKey = getPublicKey({
        chain: params.coin.chain,
        walletCore,
        publicKeys: this.vaultData.publicKeys,
        hexChainCode: this.vaultData.hexChainCode,
      })

      // Build the keysign payload using core function
      const keysignPayload = await buildSendKeysignPayload({
        coin: params.coin,
        receiver: params.receiver,
        amount: params.amount,
        memo: params.memo,
        vaultId: this.vaultData.publicKeys.ecdsa,
        localPartyId: this.vaultData.localPartyId,
        publicKey,
        walletCore,
        libType: this.vaultData.libType,
        feeSettings: params.feeSettings,
      })

      return keysignPayload
    } catch (error) {
      throw new VaultError(
        VaultErrorCode.InvalidConfig,
        `Failed to prepare send transaction: ${(error as Error).message}`,
        error as Error
      )
    }
  }

  /**
   * Extract message hashes from a KeysignPayload
   *
   * This helper method extracts the pre-signing message hashes from a KeysignPayload
   * that was created by prepareSendTx(). These hashes are required for signing.
   *
   * @param keysignPayload - Payload from prepareSendTx()
   * @returns Array of hex-encoded message hashes
   *
   * @example
   * ```typescript
   * const keysignPayload = await transactionBuilder.prepareSendTx({ ... })
   * const messageHashes = await transactionBuilder.extractMessageHashes(keysignPayload)
   * const signingPayload = { transaction: keysignPayload, chain, messageHashes }
   * const signature = await vault.sign('fast', signingPayload, password)
   * ```
   */
  async extractMessageHashes(keysignPayload: KeysignPayload): Promise<string[]> {
    try {
      // Get WalletCore instance via WasmProvider
      const walletCore = await this.wasmProvider.getWalletCore()

      // Get chain from keysign payload
      const chain = getKeysignChain(keysignPayload)

      // Get public key data and create WalletCore PublicKey
      const publicKeyData = getKeysignTwPublicKey(keysignPayload)
      const publicKeyType = getTwPublicKeyType({ walletCore, chain })
      const publicKey = walletCore.PublicKey.createWithData(publicKeyData, publicKeyType)

      // Get encoded signing inputs (compiled transaction data)
      const txInputsArray = getEncodedSigningInputs({
        keysignPayload,
        walletCore,
        publicKey,
      })

      // Extract message hashes from each transaction input
      const allMessageHashes: string[] = []
      for (const txInputData of txInputsArray) {
        const messageHashes = getPreSigningHashes({
          walletCore,
          txInputData,
          chain,
        })

        // Convert Uint8Array hashes to hex strings
        const hexHashes = messageHashes.map(hash => Buffer.from(hash).toString('hex'))
        allMessageHashes.push(...hexHashes)
      }

      return allMessageHashes
    } catch (error) {
      throw new VaultError(
        VaultErrorCode.SigningFailed,
        `Failed to extract message hashes: ${(error as Error).message}`,
        error as Error
      )
    }
  }
}
