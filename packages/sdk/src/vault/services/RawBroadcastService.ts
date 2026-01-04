import { Chain, CosmosChain, EvmChain, OtherChain, UtxoBasedChain } from '@core/chain/Chain'
import { isChainOfKind } from '@core/chain/ChainKind'
import { getCosmosClient } from '@core/chain/chains/cosmos/client'
import { getEvmClient } from '@core/chain/chains/evm/client'
import { polkadotRpcUrl } from '@core/chain/chains/polkadot/client'
import { getRippleClient } from '@core/chain/chains/ripple/client'
import { getSolanaClient } from '@core/chain/chains/solana/client'
import { getSuiClient } from '@core/chain/chains/sui/client'
import { tronRpcUrl } from '@core/chain/chains/tron/config'
import { getBlockchairBaseUrl } from '@core/chain/chains/utxo/client/getBlockchairBaseUrl'
import { rootApiUrl } from '@core/config'
import { attempt } from '@lib/utils/attempt'
import { extractErrorMsg } from '@lib/utils/error/extractErrorMsg'
import { isInError } from '@lib/utils/error/isInError'
import { ensureHexPrefix } from '@lib/utils/hex/ensureHexPrefix'
import { queryUrl } from '@lib/utils/query/queryUrl'
import base58 from 'bs58'

import { VaultError, VaultErrorCode } from '../VaultError'

type BlockchairBroadcastResponse =
  | {
      data: {
        transaction_hash: string
      } | null
    }
  | {
      data: null
      context: {
        error: string
      }
    }

/**
 * RawBroadcastService
 *
 * Handles broadcasting of pre-signed raw transactions to blockchain networks.
 * This is used for arbitrary transaction signing workflows where users construct
 * and sign transactions externally (e.g., with ethers.js or bitcoinjs-lib).
 *
 * Unlike BroadcastService which requires a KeysignPayload and compiles transactions
 * with TrustWallet Core, this service accepts already-signed raw transaction bytes
 * and broadcasts them directly to the network.
 */
export class RawBroadcastService {
  /**
   * Broadcast a pre-signed raw transaction to the blockchain network
   *
   * @param params - Broadcast parameters
   * @param params.chain - Target blockchain
   * @param params.rawTx - Hex-encoded signed transaction (with or without 0x prefix)
   *
   * @returns Transaction hash on success
   *
   * @throws {VaultError} With code BroadcastFailed if broadcast fails
   * @throws {VaultError} With code UnsupportedChain if chain is not yet supported
   *
   * @example
   * ```typescript
   * // EVM transaction built with ethers.js
   * const txHash = await rawBroadcastService.broadcastRawTx({
   *   chain: Chain.Ethereum,
   *   rawTx: '0x02f8...',
   * })
   *
   * // Bitcoin transaction built with bitcoinjs-lib
   * const btcTxHash = await rawBroadcastService.broadcastRawTx({
   *   chain: Chain.Bitcoin,
   *   rawTx: '0200000001...',
   * })
   * ```
   */
  async broadcastRawTx(params: { chain: Chain; rawTx: string }): Promise<string> {
    const { chain, rawTx } = params

    try {
      if (isChainOfKind(chain, 'evm')) {
        return await this.broadcastEvmRawTx(chain, rawTx)
      }

      if (isChainOfKind(chain, 'utxo')) {
        return await this.broadcastUtxoRawTx(chain, rawTx)
      }

      if (chain === OtherChain.Solana) {
        return await this.broadcastSolanaRawTx(rawTx)
      }

      if (isChainOfKind(chain, 'cosmos')) {
        return await this.broadcastCosmosRawTx(chain as CosmosChain, rawTx)
      }

      if (chain === OtherChain.Ton) {
        return await this.broadcastTonRawTx(rawTx)
      }

      if (chain === OtherChain.Polkadot) {
        return await this.broadcastPolkadotRawTx(rawTx)
      }

      if (chain === OtherChain.Ripple) {
        return await this.broadcastRippleRawTx(rawTx)
      }

      if (chain === OtherChain.Sui) {
        return await this.broadcastSuiRawTx(rawTx)
      }

      if (chain === OtherChain.Tron) {
        return await this.broadcastTronRawTx(rawTx)
      }

      throw new VaultError(VaultErrorCode.UnsupportedChain, `Raw broadcast not yet supported for chain: ${chain}`)
    } catch (error) {
      if (error instanceof VaultError) {
        throw error
      }
      throw new VaultError(
        VaultErrorCode.BroadcastFailed,
        `Failed to broadcast raw transaction on ${chain}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : new Error(String(error))
      )
    }
  }

  /**
   * Broadcast a raw EVM transaction
   */
  private async broadcastEvmRawTx(chain: EvmChain, rawTx: string): Promise<string> {
    const client = getEvmClient(chain)

    const { data: txHash, error } = await attempt(
      client.sendRawTransaction({
        serializedTransaction: ensureHexPrefix(rawTx) as `0x${string}`,
      })
    )

    if (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      // Ignore certain errors that indicate the tx was already submitted
      if (
        isInError(
          error,
          'already known',
          'transaction is temporarily banned',
          'nonce too low',
          'transaction already exists',
          'future transaction tries to replace pending',
          'could not replace existing tx',
          'tx already in mempool'
        )
      ) {
        // For "already known" errors, we can't reliably get the tx hash
        // The caller should compute it from the raw tx if needed
        throw new VaultError(
          VaultErrorCode.BroadcastFailed,
          `Transaction may have already been submitted: ${errorMessage}`,
          error instanceof Error ? error : new Error(errorMessage)
        )
      }
      throw error
    }

    return txHash
  }

  /**
   * Broadcast a raw UTXO transaction (Bitcoin, Litecoin, etc.)
   */
  private async broadcastUtxoRawTx(chain: UtxoBasedChain, rawTx: string): Promise<string> {
    const url = `${getBlockchairBaseUrl(chain)}/push/transaction`

    // Strip 0x prefix if present and ensure it's just hex
    const hexTx = rawTx.startsWith('0x') ? rawTx.slice(2) : rawTx

    const response = await queryUrl<BlockchairBroadcastResponse>(url, {
      body: {
        data: hexTx,
      },
    })

    if (response.data?.transaction_hash) {
      return response.data.transaction_hash
    }

    const errorMsg = 'context' in response ? response.context.error : extractErrorMsg(response)

    // Ignore certain errors that indicate the tx was already submitted
    if (isInError(errorMsg, 'BadInputsUTxO', 'timed out', 'txn-mempool-conflict', 'already known')) {
      throw new VaultError(
        VaultErrorCode.BroadcastFailed,
        `Transaction may have already been submitted or has conflicting inputs: ${errorMsg}`
      )
    }

    throw new Error(`Failed to broadcast transaction: ${extractErrorMsg(errorMsg)}`)
  }

  /**
   * Broadcast a raw Solana transaction
   * @param rawTx - Base58 or Base64 encoded signed transaction
   */
  private async broadcastSolanaRawTx(rawTx: string): Promise<string> {
    const client = getSolanaClient()

    // Detect format: base58 (no padding, no +/) vs base64 (may have = padding or +/)
    const isBase64 = rawTx.includes('=') || /[+/]/.test(rawTx)
    const txBytes = isBase64 ? Buffer.from(rawTx, 'base64') : base58.decode(rawTx)

    const { data: signature, error } = await attempt(
      client.sendRawTransaction(txBytes, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
        maxRetries: 3,
      })
    )

    if (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (isInError(error, 'already been processed', 'AlreadyProcessed')) {
        throw new VaultError(
          VaultErrorCode.BroadcastFailed,
          `Transaction may have already been submitted: ${errorMessage}`,
          error instanceof Error ? error : new Error(errorMessage)
        )
      }
      throw error
    }

    return signature
  }

  /**
   * Broadcast a raw Cosmos transaction (works for all Cosmos-based chains)
   * @param chain - The Cosmos chain to broadcast to
   * @param rawTx - JSON string with tx_bytes (base64) OR raw base64 protobuf bytes
   */
  private async broadcastCosmosRawTx(chain: CosmosChain, rawTx: string): Promise<string> {
    // Support both formats:
    // 1. JSON: { "tx_bytes": "base64..." }
    // 2. Raw base64 protobuf bytes
    let txBytes: Uint8Array

    try {
      const parsed = JSON.parse(rawTx)
      txBytes = Buffer.from(parsed.tx_bytes, 'base64')
    } catch {
      // Assume raw base64
      txBytes = Buffer.from(rawTx, 'base64')
    }

    const client = await getCosmosClient(chain)
    const { data: result, error } = await attempt(client.broadcastTx(txBytes))

    if (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (isInError(error, 'tx already exists in cache', 'account sequence mismatch')) {
        throw new VaultError(
          VaultErrorCode.BroadcastFailed,
          `Transaction may have already been submitted: ${errorMessage}`,
          error instanceof Error ? error : new Error(errorMessage)
        )
      }
      throw error
    }

    return result.transactionHash
  }

  /**
   * Broadcast a raw TON transaction
   * @param rawTx - BOC (Bag of Cells) as base64 string
   */
  private async broadcastTonRawTx(rawTx: string): Promise<string> {
    const url = `${rootApiUrl}/ton/v2/sendBocReturnHash`

    const { data: response, error } = await attempt(
      queryUrl<{ result: { hash: string } }>(url, {
        body: { boc: rawTx },
      })
    )

    if (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (isInError(error, 'duplicate message')) {
        throw new VaultError(
          VaultErrorCode.BroadcastFailed,
          `Transaction may have already been submitted: ${errorMessage}`,
          error instanceof Error ? error : new Error(errorMessage)
        )
      }
      throw error
    }

    return response.result.hash
  }

  /**
   * Broadcast a raw Polkadot transaction
   * @param rawTx - Hex-encoded extrinsic (with or without 0x prefix)
   */
  private async broadcastPolkadotRawTx(rawTx: string): Promise<string> {
    const hexWithPrefix = ensureHexPrefix(rawTx)

    const { data: response, error } = await attempt(
      queryUrl<{ result: string; error?: { message: string } }>(polkadotRpcUrl, {
        body: {
          jsonrpc: '2.0',
          method: 'author_submitExtrinsic',
          params: [hexWithPrefix],
          id: 1,
        },
      })
    )

    if (error) {
      throw error
    }

    if (response.error) {
      throw new Error(`Polkadot broadcast failed: ${response.error.message}`)
    }

    return response.result
  }

  /**
   * Broadcast a raw Ripple/XRP transaction
   * @param rawTx - Hex-encoded signed transaction blob
   */
  private async broadcastRippleRawTx(rawTx: string): Promise<string> {
    const client = await getRippleClient()

    // Strip 0x prefix if present
    const txBlob = rawTx.startsWith('0x') ? rawTx.slice(2) : rawTx

    const { data: response, error } = await attempt(
      client.request({
        command: 'submit',
        tx_blob: txBlob,
      })
    )

    if (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (isInError(error, 'tefPAST_SEQ', 'tefALREADY')) {
        throw new VaultError(
          VaultErrorCode.BroadcastFailed,
          `Transaction may have already been submitted: ${errorMessage}`,
          error instanceof Error ? error : new Error(errorMessage)
        )
      }
      throw error
    }

    // Response contains tx hash in result.tx_json.hash
    return response.result.tx_json.hash
  }

  /**
   * Broadcast a raw Sui transaction
   * @param rawTx - JSON string with { unsignedTx, signature }
   */
  private async broadcastSuiRawTx(rawTx: string): Promise<string> {
    const { unsignedTx, signature } = JSON.parse(rawTx)

    if (!unsignedTx || !signature) {
      throw new VaultError(
        VaultErrorCode.BroadcastFailed,
        'Sui broadcast requires JSON with "unsignedTx" and "signature" fields'
      )
    }

    const client = getSuiClient()
    const { data: result, error } = await attempt(
      client.executeTransactionBlock({
        transactionBlock: unsignedTx,
        signature: [signature],
      })
    )

    if (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (isInError(error, 'Transaction already executed')) {
        throw new VaultError(
          VaultErrorCode.BroadcastFailed,
          `Transaction may have already been submitted: ${errorMessage}`,
          error instanceof Error ? error : new Error(errorMessage)
        )
      }
      throw error
    }

    return result.digest
  }

  /**
   * Broadcast a raw Tron transaction
   * @param rawTx - JSON transaction object (stringified)
   */
  private async broadcastTronRawTx(rawTx: string): Promise<string> {
    // Parse JSON if string
    const txJson = JSON.parse(rawTx)

    const { data: response, error } = await attempt(
      queryUrl<{ txid?: string; result?: boolean; code?: string; message?: string }>(
        `${tronRpcUrl}/wallet/broadcasttransaction`,
        { body: txJson }
      )
    )

    if (error) {
      throw error
    }

    if (response.code && response.code !== 'SUCCESS') {
      const errorMsg = response.message || response.code
      if (isInError(errorMsg, 'DUPLICATE_TRANSACTION', 'DUP_TRANSACTION_ERROR')) {
        throw new VaultError(VaultErrorCode.BroadcastFailed, `Transaction may have already been submitted: ${errorMsg}`)
      }
      throw new Error(`Tron broadcast failed: ${errorMsg}`)
    }

    if (!response.txid) {
      throw new Error('Tron broadcast did not return transaction ID')
    }

    return response.txid
  }
}
