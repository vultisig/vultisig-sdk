import { Vault as CoreVault } from '@core/mpc/vault/Vault'
import { WalletCore } from '@trustwallet/wallet-core'
import {
  ChainStrategy,
  ParsedTransaction,
  KeysignPayload,
  KeysignOptions
} from '../strategies/ChainStrategy'
import { Balance, Signature, SigningPayload } from '../../types'
import { getUtxoChainConfig } from './config'
import { ParsedUtxoTransaction } from './types'
import { UtxoChain } from '@core/chain/Chain'
import { getPublicKey } from '@core/chain/publicKey/getPublicKey'
import { deriveAddress } from '@core/chain/publicKey/address/deriveAddress'
import { getCoinBalance } from '@core/chain/coin/balance'

/**
 * Strategy implementation for UTXO-based chains (Bitcoin, Litecoin, etc.)
 * Supports: Bitcoin, Bitcoin Cash, Litecoin, Dogecoin, Dash, Zcash
 *
 * Key differences from EVM:
 * - Multi-message signing: UTXO transactions can have multiple inputs
 * - PSBT format: Uses base64-encoded Partially Signed Bitcoin Transactions
 * - Transaction compilation: Must compile final transaction after signing
 * - Address formats: Supports legacy, SegWit, and bech32
 */
export class UtxoStrategy implements ChainStrategy {
  readonly chainId: string
  private readonly utxoChain: UtxoChain
  private readonly config

  constructor(chainId: string) {
    this.chainId = chainId
    this.utxoChain = chainId as UtxoChain
    this.config = getUtxoChainConfig(chainId)
  }

  /**
   * Derive UTXO address for vault
   * Uses existing AddressDeriver infrastructure
   */
  async deriveAddress(vault: CoreVault): Promise<string> {
    const walletCore = await this.getWalletCore()

    // Get public key (UTXO chains use ECDSA)
    const publicKey = getPublicKey({
      chain: this.utxoChain,
      walletCore,
      publicKeys: vault.publicKeys,
      hexChainCode: vault.hexChainCode,
    })

    // Derive address from public key
    const address = deriveAddress({
      chain: this.utxoChain,
      publicKey,
      walletCore
    })

    return address
  }

  /**
   * Get balance for UTXO address
   * Uses existing Blockchair integration for 5-10x faster balance fetching
   */
  async getBalance(address: string): Promise<Balance> {
    // Use existing getCoinBalance which leverages Blockchair for UTXO chains
    const rawBalance = await getCoinBalance({
      chain: this.utxoChain,
      address
    })

    return {
      amount: rawBalance.toString(),
      decimals: this.config.decimals,
      symbol: this.config.symbol
    }
  }

  /**
   * Parse UTXO transaction (PSBT format)
   * TODO: Implement PSBT parsing using bitcoinjs-lib
   */
  async parseTransaction(rawTx: string | Uint8Array): Promise<ParsedTransaction> {
    // For now, return a basic structure
    // TODO: Implement full PSBT parsing with bitcoinjs-lib
    const psbtBase64 = typeof rawTx === 'string' ? rawTx : Buffer.from(rawTx).toString('base64')

    const parsed = {
      psbtBase64,
      inputCount: 0,
      outputCount: 0,
    }

    // Return as ParsedTransaction (with UTXO-specific fields)
    return parsed as unknown as ParsedTransaction
  }

  /**
   * Build keysign payload for UTXO transaction
   * Extracted from ServerManager lines 265-282
   */
  async buildKeysignPayload(
    tx: ParsedTransaction,
    vaultPublicKey: string,
    options?: KeysignOptions
  ): Promise<KeysignPayload> {
    const { create } = await import('@bufbuild/protobuf')
    const { KeysignPayloadSchema } = await import('@core/mpc/types/vultisig/keysign/v1/keysign_message_pb')

    const walletCore = await this.getWalletCore()
    const utxoTx = tx as unknown as ParsedUtxoTransaction

    // Derive address for this vault
    const publicKey = vaultPublicKey
    // Note: In practice, we'd need the full vault to derive address properly
    // For now, we'll use a placeholder address
    const address = '' // TODO: Pass vault or address from caller

    // Build KeysignPayload with UTXOSpecific blockchain type
    const keysignPayload = create(KeysignPayloadSchema, {
      coin: {
        chain: this.config.blockchairName,
        address,
      },
      blockchainSpecific: {
        case: 'utxoSpecific',
        value: {
          $typeName: 'vultisig.keysign.v1.UTXOSpecific',
          byteFee: '1',
          sendMaxAmount: false,
        },
      },
      toAddress: address,
      toAmount: '0',
      memo: utxoTx.psbtBase64, // PSBT encoded in memo field
    })

    return keysignPayload
  }

  /**
   * Compute pre-signing hashes for Fast Vault signing
   * Extracted from ServerManager lines 583-632
   *
   * UTXO transactions can have multiple inputs, each requiring a separate signature.
   * This method:
   * 1. Validates PSBT is present
   * 2. Creates KeysignPayload with UTXOSpecific
   * 3. Extracts transaction input data
   * 4. Computes pre-signing hashes for each input
   * 5. Returns array of hashes (one per input)
   */
  async computePreSigningHashes(
    payload: SigningPayload,
    vault: any,
    walletCore: any
  ): Promise<string[]> {
    // Import required utilities
    const { create } = await import('@bufbuild/protobuf')
    const { KeysignPayloadSchema } = await import('@core/mpc/types/vultisig/keysign/v1/keysign_message_pb')
    const { getTxInputData } = await import('@core/mpc/keysign/txInputData')
    const { getPreSigningHashes } = await import('@core/chain/tx/preSigningHashes')

    // Get public key and address for this vault
    const publicKey = getPublicKey({
      chain: this.utxoChain,
      walletCore,
      hexChainCode: vault.hexChainCode,
      publicKeys: vault.publicKeys,
    })

    const address = deriveAddress({
      chain: this.utxoChain,
      publicKey,
      walletCore
    })

    // Validate PSBT is present
    const psbtBase64 = (payload as any)?.transaction?.psbtBase64
    if (!psbtBase64) {
      throw new Error(
        `${this.chainId} signing requires transaction.psbtBase64. ` +
        'Please provide a base64-encoded PSBT in the transaction payload.'
      )
    }

    // Create KeysignPayload with UTXOSpecific blockchain type
    const keysignPayload = create(KeysignPayloadSchema, {
      coin: {
        chain: this.config.blockchairName,
        address,
      },
      blockchainSpecific: {
        case: 'utxoSpecific',
        value: {
          $typeName: 'vultisig.keysign.v1.UTXOSpecific',
          byteFee: '1',
          sendMaxAmount: false,
        },
      },
      toAddress: address,
      toAmount: '0',
      memo: psbtBase64, // PSBT encoded in memo field
    })

    // Extract transaction input data from PSBT
    const inputs = getTxInputData({
      keysignPayload,
      walletCore,
      publicKey,
    })

    // Compute pre-signing hashes for each input
    // UTXO transactions with multiple inputs will have multiple hashes
    const hashes = inputs
      .flatMap(txInputData =>
        getPreSigningHashes({ walletCore, chain: this.utxoChain, txInputData })
      )
      .map(value => Buffer.from(value).toString('hex'))

    console.log(`✅ Computed ${hashes.length} pre-signing hash(es) for ${this.chainId} transaction`)

    return hashes
  }

  /**
   * Format signature results from MPC keysign
   * Extracted from ServerManager lines 252-315
   *
   * UTXO signing process:
   * 1. Extract DER signatures from MPC results
   * 2. Recreate transaction input data
   * 3. Compile fully signed transaction
   * 4. Return compiled transaction hex
   */
  async formatSignatureResult(
    signatureResults: Record<string, any>,
    payload: SigningPayload
  ): Promise<Signature> {
    // Import required utilities
    const { create } = await import('@bufbuild/protobuf')
    const { KeysignPayloadSchema } = await import('@core/mpc/types/vultisig/keysign/v1/keysign_message_pb')
    const { getTxInputData } = await import('@core/mpc/keysign/txInputData')
    const { compileTx } = await import('@core/chain/tx/compile/compileTx')
    const { decodeSigningOutput } = await import('@core/chain/tw/signingOutput')

    // Get WalletCore and vault from payload context
    const walletCore = await this.getWalletCore()
    const vault = (payload as any).vault // TODO: Better type handling

    // Get public key and address
    const publicKey = getPublicKey({
      chain: this.utxoChain,
      walletCore,
      hexChainCode: vault.hexChainCode,
      publicKeys: vault.publicKeys,
    })

    const address = deriveAddress({
      chain: this.utxoChain,
      publicKey,
      walletCore
    })

    // Recreate KeysignPayload to get transaction input data
    const psbtBase64 = (payload as any)?.transaction?.psbtBase64
    const keysignPayload = create(KeysignPayloadSchema, {
      coin: {
        chain: this.config.blockchairName,
        address,
      },
      blockchainSpecific: {
        case: 'utxoSpecific',
        value: {
          $typeName: 'vultisig.keysign.v1.UTXOSpecific',
          byteFee: '1',
          sendMaxAmount: false,
        },
      },
      toAddress: address,
      toAmount: '0',
      memo: psbtBase64,
    })

    // Get transaction input data
    const inputs = getTxInputData({
      keysignPayload,
      walletCore,
      publicKey,
    })

    // Extract DER signatures from MPC results
    const derSignatures: Record<string, any> = {}
    for (const [msg, sigResult] of Object.entries(signatureResults)) {
      derSignatures[msg] = sigResult.der_signature
    }

    // Compile fully signed transaction
    const compiledTxs = inputs.map(txInputData =>
      compileTx({
        publicKey,
        txInputData,
        signatures: derSignatures,
        chain: this.utxoChain,
        walletCore,
      })
    )

    // For UTXO, we expect a single compiled transaction
    const [compiled] = compiledTxs
    const decoded = decodeSigningOutput(this.utxoChain, compiled)
    const finalTxHex = (decoded as any).encoded || compiled

    console.log(`✅ ${this.chainId} transaction compiled successfully`)

    return {
      signature: finalTxHex,
      format: 'DER',
    }
  }

  /**
   * Get WalletCore instance via singleton
   */
  private async getWalletCore(): Promise<WalletCore> {
    const { WASMManager } = await import('../../wasm/WASMManager')
    return WASMManager.getInstance().getWalletCore()
  }
}
