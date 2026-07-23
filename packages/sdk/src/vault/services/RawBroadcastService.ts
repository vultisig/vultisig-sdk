import { assertIsDeliverTxSuccess } from '@cosmjs/stargate'
import { sha256 } from '@noble/hashes/sha2'
import { bytesToHex } from '@noble/hashes/utils'
import { Chain, CosmosChain, EvmChain, OtherChain, UtxoBasedChain } from '@vultisig/core-chain/Chain'
import { isChainOfKind } from '@vultisig/core-chain/ChainKind'
import { bittensorRpcUrl } from '@vultisig/core-chain/chains/bittensor/client'
import { getCosmosClient } from '@vultisig/core-chain/chains/cosmos/client'
import { getEvmClient } from '@vultisig/core-chain/chains/evm/client'
import { polkadotRpcUrl } from '@vultisig/core-chain/chains/polkadot/client'
import { getRippleClient } from '@vultisig/core-chain/chains/ripple/client'
import { getSolanaClient } from '@vultisig/core-chain/chains/solana/client'
import { getSuiClient } from '@vultisig/core-chain/chains/sui/client'
import { tronRpcUrl } from '@vultisig/core-chain/chains/tron/config'
import { getBlockchairBaseUrl } from '@vultisig/core-chain/chains/utxo/client/getBlockchairBaseUrl'
import { isRippleInFlightEngineResult } from '@vultisig/core-chain/tx/broadcast/resolvers/ripple'
import { assertSuiTxSucceeded } from '@vultisig/core-chain/tx/broadcast/resolvers/sui'
import { rootApiUrl } from '@vultisig/core-config'
import { attempt } from '@vultisig/lib-utils/attempt'
import { extractErrorMsg } from '@vultisig/lib-utils/error/extractErrorMsg'
import { isInError } from '@vultisig/lib-utils/error/isInError'
import { ensureHexPrefix } from '@vultisig/lib-utils/hex/ensureHexPrefix'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'
import base58 from 'bs58'
import { keccak256 } from 'viem'
import { hashes as xrplHashes } from 'xrpl'

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

const deriveEvmRawTxHash = (rawTx: string): string => keccak256(ensureHexPrefix(rawTx) as `0x${string}`)

const getCosmosRawTxBytes = (rawTx: string): Uint8Array => {
  try {
    const parsed = JSON.parse(rawTx)
    return Buffer.from(parsed.tx_bytes, 'base64')
  } catch {
    return Buffer.from(rawTx, 'base64')
  }
}

const deriveCosmosRawTxHash = (rawTx: string): string => bytesToHex(sha256(getCosmosRawTxBytes(rawTx))).toUpperCase()

const deriveSolanaRawTxSignature = (rawTx: string): string => {
  const isBase64 = rawTx.includes('=') || /[+/]/.test(rawTx)
  const txBytes = isBase64 ? Buffer.from(rawTx, 'base64') : base58.decode(rawTx)
  let offset = 0
  let signatureCount = 0
  let shift = 0

  while (offset < txBytes.length) {
    const byte = txBytes[offset]
    signatureCount |= (byte & 0x7f) << shift
    offset += 1
    if ((byte & 0x80) === 0) break
    shift += 7
  }

  if (signatureCount < 1 || txBytes.length < offset + 64) {
    throw new Error('Solana raw transaction does not contain a primary signature')
  }

  return base58.encode(txBytes.subarray(offset, offset + 64))
}

const deriveRippleRawTxHash = (rawTx: string): string =>
  xrplHashes.hashSignedTx(rawTx.startsWith('0x') ? rawTx.slice(2) : rawTx)

const deriveTronRawTxHash = (txJson: { raw_data_hex?: unknown; txID?: unknown }): string | null => {
  if (
    typeof txJson.raw_data_hex !== 'string' ||
    txJson.raw_data_hex.length === 0 ||
    txJson.raw_data_hex.length % 2 !== 0 ||
    !/^[0-9a-fA-F]+$/.test(txJson.raw_data_hex)
  ) {
    return null
  }

  const derivedHash = bytesToHex(sha256(Buffer.from(txJson.raw_data_hex, 'hex')))
  if (txJson.txID !== undefined && (typeof txJson.txID !== 'string' || txJson.txID.toLowerCase() !== derivedHash)) {
    return null
  }

  return derivedHash
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

      if (chain === OtherChain.Bittensor) {
        return await this.broadcastBittensorRawTx(rawTx)
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
      // Ignore certain errors that indicate the tx was already submitted
      if (isInError(error, 'already known', 'transaction already exists', 'tx already in mempool')) {
        return deriveEvmRawTxHash(rawTx)
      }
      throw error
    }

    if (!txHash) throw new Error('No transaction hash returned')
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

    const { data: sentSignature, error } = await attempt(
      client.sendRawTransaction(txBytes, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
        maxRetries: 3,
      })
    )

    let signature = sentSignature
    if (error) {
      if (isInError(error, 'already been processed', 'AlreadyProcessed')) {
        // "AlreadyProcessed" only proves the node has seen and executed this signature before -
        // not that the original execution succeeded. It must go through the same on-chain-failure
        // check below as a fresh send, not be handed back as a hash unconditionally.
        signature = deriveSolanaRawTxSignature(rawTx)
      } else {
        throw error
      }
    }

    if (!signature) throw new Error('No transaction signature returned')

    // sendRawTransaction only confirms the node ACCEPTED the payload into its queue - it is
    // fire-and-forget by protocol design and never returns an execution result inline (unlike
    // Cosmos/Sui's broadcast RPCs, which block until inclusion). Full confirmation is out of
    // scope here and remains the caller's job via a status poll (mirrors the core resolver's
    // documented trade-off, packages/core/chain/tx/broadcast/resolvers/solana.ts). But a
    // signature the node already knows to have failed must not be handed back as a "hash" -
    // this bounded, non-blocking status check catches that without adding real broadcast
    // latency: it never blocks/throws on "not yet confirmed" (the normal state right after
    // submission), only on an explicit on-chain error already attached to this signature.
    // This also covers the "already been processed" idempotent-retry path above: a duplicate
    // signature that already failed on-chain must still fail closed here, not report success.
    const { data: statuses } = await attempt(
      client.getSignatureStatuses([signature], { searchTransactionHistory: true })
    )
    const signatureStatus = statuses?.value?.[0]
    if (signatureStatus?.err) {
      throw new VaultError(
        VaultErrorCode.BroadcastFailed,
        `Solana transaction was submitted but failed on-chain: ${JSON.stringify(signatureStatus.err)}`
      )
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
    const txBytes = getCosmosRawTxBytes(rawTx)

    const client = await getCosmosClient(chain)
    const { data: result, error } = await attempt(client.broadcastTx(txBytes))

    if (error) {
      if (isInError(error, 'tx already exists in cache')) {
        const hash = deriveCosmosRawTxHash(rawTx)
        const { data: existingTx, error: lookupError } = await attempt(client.getTx(hash))

        if (!existingTx) {
          const lookupMessage = lookupError instanceof Error ? lookupError.message : String(lookupError ?? 'not found')
          throw new VaultError(
            VaultErrorCode.BroadcastFailed,
            `Cosmos transaction may already exist, but its execution result could not be verified: ${lookupMessage}`,
            lookupError instanceof Error ? lookupError : new Error(lookupMessage)
          )
        }

        try {
          assertIsDeliverTxSuccess({ ...existingTx, transactionHash: existingTx.hash })
        } catch (deliverTxError) {
          const message = deliverTxError instanceof Error ? deliverTxError.message : String(deliverTxError)
          throw new VaultError(
            VaultErrorCode.BroadcastFailed,
            `Cosmos transaction was included but execution failed: ${message}`,
            deliverTxError instanceof Error ? deliverTxError : new Error(message)
          )
        }

        return hash
      }
      throw error
    }

    if (!result) throw new Error('No broadcast result returned')

    // `StargateClient.broadcastTx` RESOLVES (does not throw) once the tx is included in a block,
    // even when execution failed (DeliverTx `code !== 0` — out-of-gas, wasm revert, a THORChain/Maya
    // deposit-handler rejection). The tx is on-chain but nothing moved, so returning its hash here
    // would be a false success. The signing-input broadcast resolver (tx/broadcast/resolvers/cosmos.ts,
    // #1316) already asserts this; this raw path — reachable via the public `vault.broadcastRawTx` —
    // must fail closed the same way.
    try {
      assertIsDeliverTxSuccess(result)
    } catch (deliverTxError) {
      const message = deliverTxError instanceof Error ? deliverTxError.message : String(deliverTxError)
      throw new VaultError(
        VaultErrorCode.BroadcastFailed,
        `Cosmos transaction was included but execution failed: ${message}`,
        deliverTxError instanceof Error ? deliverTxError : new Error(message)
      )
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

    if (!response) throw new Error('No response returned')
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

    if (!response) throw new Error('No response returned')

    if (response.error) {
      throw new Error(`Polkadot broadcast failed: ${response.error.message}`)
    }

    // Per JSON-RPC 2.0 a valid response must have exactly one of `result` / `error`. If both
    // are missing (malformed gateway response, truncated body, ...) do not silently return
    // `undefined` as a success hash - fail closed instead.
    if (!response.result) {
      throw new Error('Polkadot broadcast failed: missing extrinsic hash in RPC response')
    }

    return response.result
  }

  /**
   * Broadcast a raw Bittensor transaction
   * @param rawTx - Hex-encoded extrinsic (with or without 0x prefix)
   */
  private async broadcastBittensorRawTx(rawTx: string): Promise<string> {
    const hexWithPrefix = ensureHexPrefix(rawTx)

    const { data: response, error } = await attempt(
      queryUrl<{ result: string; error?: { message: string } }>(bittensorRpcUrl, {
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

    if (!response) {
      throw new Error('Bittensor broadcast returned no response')
    }

    if (response.error) {
      throw new Error(`Bittensor broadcast failed: ${response.error.message}`)
    }

    // Same JSON-RPC 2.0 invariant as Polkadot: a response with neither `result` nor `error`
    // is malformed, not a success - fail closed instead of returning `undefined` as a hash.
    if (!response.result) {
      throw new Error('Bittensor broadcast failed: missing extrinsic hash in RPC response')
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
      throw error
    }

    const result = response?.result
    if (!result || typeof result.engine_result_code !== 'number') {
      throw new Error('Ripple broadcast did not return an engine result')
    }

    const engineResultCode = result.engine_result_code
    const engineResult = result.engine_result ?? 'unknown'
    if (engineResultCode !== 0) {
      if (engineResult === 'tefALREADY') {
        return deriveRippleRawTxHash(rawTx)
      }

      if (isRippleInFlightEngineResult(engineResult)) {
        return result.tx_json?.hash ?? deriveRippleRawTxHash(rawTx)
      }

      const engineResultMessage = result.engine_result_message ?? ''
      throw new Error(
        `Ripple broadcast rejected: ${engineResult}${engineResultMessage ? ` — ${engineResultMessage}` : ''}`
      )
    }

    if (!result.tx_json?.hash) throw new Error('No transaction hash returned')
    return result.tx_json.hash
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
        options: { showEffects: true },
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

    if (!result) throw new Error('No broadcast result returned')
    assertSuiTxSucceeded(result.effects)
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

    if (!response) throw new Error('No response returned')

    // `result === false` is Tron's own explicit failure signal, independent of `code` (which
    // core/chain/tx/broadcast/resolvers/tron.ts also checks separately) - a response carrying
    // `result: false` without a `code` must not fall through to the txid check below and be
    // reported as a success.
    if (response.result === false || (response.code && response.code !== 'SUCCESS')) {
      const decodedMessage = response.message ? Buffer.from(response.message, 'hex').toString('utf8') : ''
      const errorMsg = decodedMessage || response.code || 'Unknown error'
      if (response.code && isInError(response.code, 'DUPLICATE_TRANSACTION', 'DUP_TRANSACTION_ERROR')) {
        const localHash = deriveTronRawTxHash(txJson)
        if (localHash) {
          return localHash
        }
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
