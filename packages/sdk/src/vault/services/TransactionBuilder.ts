import { Chain, CosmosChain } from '@vultisig/core-chain/Chain'
import { isChainOfKind } from '@vultisig/core-chain/ChainKind'
import { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import { getCoinType } from '@vultisig/core-chain/coin/coinType'
import { getPublicKey } from '@vultisig/core-chain/publicKey/getPublicKey'
import { getTwPublicKeyType } from '@vultisig/core-chain/publicKey/tw/getTwPublicKeyType'
import { isValidAddress } from '@vultisig/core-chain/utils/isValidAddress'
import { FeeSettings } from '@vultisig/core-mpc/keysign/chainSpecific/FeeSettings'
import { getSendFeeEstimate } from '@vultisig/core-mpc/keysign/send/getSendFeeEstimate'
import { getEncodedSigningInputs } from '@vultisig/core-mpc/keysign/signingInputs'
import { getKeysignTwPublicKey } from '@vultisig/core-mpc/keysign/tw/getKeysignTwPublicKey'
import { getKeysignChain } from '@vultisig/core-mpc/keysign/utils/getKeysignChain'
import { getPreSigningHashes } from '@vultisig/core-mpc/tx/preSigningHashes'
import { toKeysignLibType } from '@vultisig/core-mpc/types/utils/libType'
import { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { Vault as CoreVault } from '@vultisig/core-mpc/vault/Vault'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'

import type { WasmProvider } from '../../context/SdkContext'
import { prepareContractCallTxFromKeys } from '../../tools/prep/contractCall'
import { prepareSignAminoTxFromKeys, prepareSignDirectTxFromKeys } from '../../tools/prep/cosmos'
import { prepareSendTxFromKeys } from '../../tools/prep/send'
import { vaultDataToIdentity } from '../../tools/prep/types'
import type { ContractCallTxParams } from '../../types/contractCall'
import type { CosmosSigningOptions, SignAminoInput, SignDirectInput } from '../../types/cosmos'
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
    if (params.amount <= 0n) {
      throw new VaultError(VaultErrorCode.InvalidAmount, 'Amount must be greater than zero')
    }
    try {
      const walletCore = await this.wasmProvider.getWalletCore()
      return await prepareSendTxFromKeys(vaultDataToIdentity(this.vaultData), params, walletCore)
    } catch (error) {
      if (error instanceof VaultError) throw error
      throw new VaultError(
        VaultErrorCode.InvalidConfig,
        `Failed to prepare send transaction: ${(error as Error).message}`,
        error as Error
      )
    }
  }

  /**
   * Estimate the network fee for a send transaction
   *
   * Builds a keysign payload internally and extracts the fee amount
   * without returning the full payload.
   *
   * @param params - Transaction parameters (same as prepareSendTx)
   * @returns Fee amount in base units (e.g., wei)
   */
  async estimateSendFee(params: {
    coin: AccountCoin
    receiver: string
    amount: bigint
    memo?: string
    feeSettings?: FeeSettings
  }): Promise<bigint> {
    try {
      const walletCore = await this.wasmProvider.getWalletCore()

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

      if (params.amount <= 0n) {
        throw new VaultError(VaultErrorCode.InvalidAmount, 'Amount must be greater than zero')
      }

      const isQbtc = params.coin.chain === Chain.QBTC
      const publicKey = isQbtc
        ? null
        : getPublicKey({
            chain: params.coin.chain,
            walletCore,
            publicKeys: this.vaultData.publicKeys,
            hexChainCode: this.vaultData.hexChainCode,
          })

      return await getSendFeeEstimate({
        coin: params.coin,
        receiver: params.receiver,
        amount: params.amount,
        memo: params.memo,
        vaultId: this.vaultData.publicKeys.ecdsa,
        localPartyId: this.vaultData.localPartyId,
        publicKey,
        hexPublicKeyOverride: isQbtc
          ? shouldBePresent(this.vaultData.publicKeyMldsa, 'Vault MLDSA public key required for QBTC fee estimate')
          : undefined,
        walletCore,
        libType: toKeysignLibType(this.vaultData),
        feeSettings: params.feeSettings,
      })
    } catch (error) {
      if (error instanceof VaultError) throw error
      throw new VaultError(
        VaultErrorCode.InvalidConfig,
        `Failed to estimate send fee: ${(error as Error).message}`,
        error as Error
      )
    }
  }

  /**
   * Prepare a contract call transaction keysign payload for EVM chains.
   *
   * Encodes the function call via ABI and builds a native-coin keysign payload
   * with the calldata as memo. This supports zero-value calls (approvals,
   * governance votes, etc.) and value-bearing calls.
   *
   * @param params - Contract call parameters
   * @param params.chain - EVM chain to call on
   * @param params.contractAddress - Target contract address
   * @param params.abi - Contract ABI (or fragment array)
   * @param params.functionName - Function to call
   * @param params.args - Function arguments
   * @param params.value - Native token value to send with call (default: 0n)
   * @param params.senderAddress - Sender address (derived from vault)
   * @param params.feeSettings - Optional custom fee settings
   *
   * @returns A KeysignPayload ready to be signed with the sign() method
   *
   * @example
   * ```typescript
   * const payload = await transactionBuilder.prepareContractCallTx({
   *   chain: Chain.Polygon,
   *   contractAddress: '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045',
   *   abi: [{ name: 'setApprovalForAll', type: 'function', inputs: [...], outputs: [] }],
   *   functionName: 'setApprovalForAll',
   *   args: ['0xC5d563A36AE78145C45a50134d48A1215220f80a', true],
   *   senderAddress: '0x...',
   * })
   * ```
   */
  async prepareContractCallTx(params: ContractCallTxParams): Promise<KeysignPayload> {
    if (!isChainOfKind(params.chain, 'evm')) {
      throw new VaultError(
        VaultErrorCode.InvalidConfig,
        `prepareContractCallTx only supports EVM chains. Got: ${params.chain}`
      )
    }
    if ((params.value ?? 0n) < 0n) {
      throw new VaultError(VaultErrorCode.InvalidAmount, 'Contract call value cannot be negative')
    }
    try {
      const walletCore = await this.wasmProvider.getWalletCore()
      return await prepareContractCallTxFromKeys(vaultDataToIdentity(this.vaultData), params, walletCore)
    } catch (error) {
      if (error instanceof VaultError) throw error
      throw new VaultError(
        VaultErrorCode.InvalidConfig,
        `Failed to prepare contract call: ${(error as Error).message}`,
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

      const publicKey =
        chain === Chain.QBTC
          ? undefined
          : (() => {
              const publicKeyData = getKeysignTwPublicKey(keysignPayload)
              const publicKeyType = getTwPublicKeyType({ walletCore, chain })
              const coinType = getCoinType({ walletCore, chain })
              const keyType =
                coinType === walletCore.CoinType.tron ? walletCore.PublicKeyType.secp256k1Extended : publicKeyType
              return walletCore.PublicKey.createWithData(publicKeyData, keyType)
            })()

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
          keysignPayload,
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
    if (!this.isCosmosChain(input.chain)) {
      throw new VaultError(
        VaultErrorCode.InvalidConfig,
        `Chain ${input.chain} does not support SignAmino. Use a Cosmos-SDK chain.`
      )
    }
    try {
      const walletCore = await this.wasmProvider.getWalletCore()
      return await prepareSignAminoTxFromKeys(vaultDataToIdentity(this.vaultData), input, options, walletCore)
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
    if (!this.isCosmosChain(input.chain)) {
      throw new VaultError(
        VaultErrorCode.InvalidConfig,
        `Chain ${input.chain} does not support SignDirect. Use a Cosmos-SDK chain.`
      )
    }
    try {
      const walletCore = await this.wasmProvider.getWalletCore()
      return await prepareSignDirectTxFromKeys(vaultDataToIdentity(this.vaultData), input, options, walletCore)
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
