import { CosmosChain } from '@core/chain/Chain'
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
import type { CosmosSigningOptions, SignAminoInput, SignDirectInput } from '../../types/cosmos'
import { VaultError, VaultErrorCode } from '../VaultError'
import { buildSignAminoKeysignPayload, buildSignDirectKeysignPayload } from './cosmos/buildCosmosPayload'

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

  /**
   * Prepare a SignAmino keysign payload for custom Cosmos messages
   *
   * SignAmino uses the legacy Amino (JSON) signing format, which is widely
   * supported across Cosmos SDK chains. Use this for governance votes,
   * staking operations, IBC transfers, and other custom messages.
   *
   * @param input - SignAmino transaction parameters
   * @param options - Optional signing options
   * @returns A KeysignPayload ready to be signed with the sign() method
   *
   * @example
   * ```typescript
   * // Prepare a governance vote
   * const payload = await transactionBuilder.prepareSignAminoTx({
   *   chain: Chain.Cosmos,
   *   coin: {
   *     chain: Chain.Cosmos,
   *     address: await vault.address(Chain.Cosmos),
   *     decimals: 6,
   *     ticker: 'ATOM',
   *   },
   *   msgs: [{
   *     type: 'cosmos-sdk/MsgVote',
   *     value: JSON.stringify({
   *       proposal_id: '123',
   *       voter: cosmosAddress,
   *       option: 'VOTE_OPTION_YES',
   *     }),
   *   }],
   *   fee: {
   *     amount: [{ denom: 'uatom', amount: '5000' }],
   *     gas: '200000',
   *   },
   * })
   * ```
   */
  async prepareSignAminoTx(input: SignAminoInput, options?: CosmosSigningOptions): Promise<KeysignPayload> {
    try {
      // Validate chain is Cosmos-based
      if (!this.isCosmosChain(input.chain)) {
        throw new VaultError(
          VaultErrorCode.InvalidConfig,
          `Chain ${input.chain} does not support SignAmino. Use a Cosmos-SDK chain.`
        )
      }

      const walletCore = await this.wasmProvider.getWalletCore()

      // Get public key for chain
      const publicKey = getPublicKey({
        chain: input.chain,
        walletCore,
        publicKeys: this.vaultData.publicKeys,
        hexChainCode: this.vaultData.hexChainCode,
      })

      return await buildSignAminoKeysignPayload({
        ...input,
        vaultId: this.vaultData.publicKeys.ecdsa,
        localPartyId: this.vaultData.localPartyId,
        publicKey,
        libType: this.vaultData.libType,
        skipChainSpecificFetch: options?.skipChainSpecificFetch,
      })
    } catch (error) {
      if (error instanceof VaultError) throw error
      throw new VaultError(
        VaultErrorCode.InvalidConfig,
        `Failed to prepare SignAmino transaction: ${(error as Error).message}`,
        error as Error
      )
    }
  }

  /**
   * Prepare a SignDirect keysign payload for custom Cosmos messages
   *
   * SignDirect uses the modern Protobuf signing format, which is more
   * efficient and type-safe. Use this when you have pre-encoded transaction
   * bytes or need exact control over the transaction structure.
   *
   * @param input - SignDirect transaction parameters
   * @param options - Optional signing options
   * @returns A KeysignPayload ready to be signed with the sign() method
   *
   * @example
   * ```typescript
   * // Prepare a pre-constructed transaction
   * const payload = await transactionBuilder.prepareSignDirectTx({
   *   chain: Chain.Cosmos,
   *   coin: {
   *     chain: Chain.Cosmos,
   *     address: await vault.address(Chain.Cosmos),
   *     decimals: 6,
   *     ticker: 'ATOM',
   *   },
   *   bodyBytes: encodedTxBodyBase64,
   *   authInfoBytes: encodedAuthInfoBase64,
   *   chainId: 'cosmoshub-4',
   *   accountNumber: '12345',
   * })
   * ```
   */
  async prepareSignDirectTx(input: SignDirectInput, options?: CosmosSigningOptions): Promise<KeysignPayload> {
    try {
      // Validate chain is Cosmos-based
      if (!this.isCosmosChain(input.chain)) {
        throw new VaultError(
          VaultErrorCode.InvalidConfig,
          `Chain ${input.chain} does not support SignDirect. Use a Cosmos-SDK chain.`
        )
      }

      const walletCore = await this.wasmProvider.getWalletCore()

      // Get public key for chain
      const publicKey = getPublicKey({
        chain: input.chain,
        walletCore,
        publicKeys: this.vaultData.publicKeys,
        hexChainCode: this.vaultData.hexChainCode,
      })

      return await buildSignDirectKeysignPayload({
        ...input,
        vaultId: this.vaultData.publicKeys.ecdsa,
        localPartyId: this.vaultData.localPartyId,
        publicKey,
        libType: this.vaultData.libType,
        skipChainSpecificFetch: options?.skipChainSpecificFetch,
      })
    } catch (error) {
      if (error instanceof VaultError) throw error
      throw new VaultError(
        VaultErrorCode.InvalidConfig,
        `Failed to prepare SignDirect transaction: ${(error as Error).message}`,
        error as Error
      )
    }
  }

  /**
   * Check if a chain is a Cosmos-SDK chain
   */
  private isCosmosChain(chain: string): chain is CosmosChain {
    const cosmosChains = [
      'Cosmos',
      'Osmosis',
      'Dydx',
      'Kujira',
      'Terra',
      'TerraClassic',
      'Noble',
      'Akash',
      'THORChain',
      'MayaChain',
    ]
    return cosmosChains.includes(chain)
  }
}
