import { Chain, EvmChain, UtxoBasedChain } from '@core/chain/Chain'
import { isChainOfKind } from '@core/chain/ChainKind'
import { getEvmClient } from '@core/chain/chains/evm/client'
import { getBlockchairBaseUrl } from '@core/chain/chains/utxo/client/getBlockchairBaseUrl'
import { attempt } from '@lib/utils/attempt'
import { extractErrorMsg } from '@lib/utils/error/extractErrorMsg'
import { isInError } from '@lib/utils/error/isInError'
import { ensureHexPrefix } from '@lib/utils/hex/ensureHexPrefix'
import { queryUrl } from '@lib/utils/query/queryUrl'

import { VaultError, VaultErrorCode } from '../VaultError'

// TODO: Add raw broadcast support for:
// - Solana (base58 encoded)
// - Cosmos (JSON + base64 tx_bytes)
// - TON (BOC format via Vultisig backend)
// - Polkadot (hex extrinsic)
// - Ripple (hex blob)
// - Cardano (CBOR hex via Ogmios)
// - Sui (unsignedTx + signature pair)
// - Tron (JSON object)

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

      throw new VaultError(
        VaultErrorCode.UnsupportedChain,
        `Raw broadcast not yet supported for chain: ${chain}. Currently supported: EVM chains, UTXO chains (Bitcoin, Litecoin, etc.)`
      )
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
}
