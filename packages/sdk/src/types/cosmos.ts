/**
 * Cosmos SDK Signing Types
 *
 * Types for SignAmino and SignDirect signing modes used by Cosmos SDK chains.
 * These enable custom Cosmos transaction signing beyond simple transfers.
 */

import type { CosmosChain } from '@core/chain/Chain'
import type { AccountCoin } from '@core/chain/coin/AccountCoin'

/**
 * Cosmos coin amount for fee specification
 */
export type CosmosCoinAmount = {
  /** Token denomination (e.g., 'uatom', 'uosmo') */
  denom: string
  /** Amount in base units as string */
  amount: string
}

/**
 * Cosmos fee specification for SignAmino transactions
 */
export type CosmosFeeInput = {
  /** Fee amounts to pay */
  amount: CosmosCoinAmount[]
  /** Gas limit as string */
  gas: string
  /** Optional fee payer address */
  payer?: string
  /** Optional fee granter address */
  granter?: string
}

/**
 * Cosmos message for SignAmino transactions
 */
export type CosmosMsgInput = {
  /** Amino type URL (e.g., 'cosmos-sdk/MsgSend', 'cosmos-sdk/MsgVote') */
  type: string
  /** JSON-stringified message value */
  value: string
}

/**
 * Input for SignAmino transaction preparation
 *
 * SignAmino uses the legacy Amino (JSON) signing format, which is widely
 * supported across Cosmos SDK chains. Use this for governance votes,
 * staking operations, and other custom messages.
 *
 * @example
 * ```typescript
 * const input: SignAminoInput = {
 *   chain: Chain.Cosmos,
 *   coin: {
 *     chain: Chain.Cosmos,
 *     address: 'cosmos1...',
 *     decimals: 6,
 *     ticker: 'ATOM',
 *   },
 *   msgs: [{
 *     type: 'cosmos-sdk/MsgVote',
 *     value: JSON.stringify({
 *       proposal_id: '123',
 *       voter: 'cosmos1...',
 *       option: 'VOTE_OPTION_YES',
 *     }),
 *   }],
 *   fee: {
 *     amount: [{ denom: 'uatom', amount: '5000' }],
 *     gas: '200000',
 *   },
 * }
 * ```
 */
export type SignAminoInput = {
  /** Cosmos chain to sign for (must be a Cosmos-SDK chain) */
  chain: CosmosChain
  /** Sender coin with address info */
  coin: AccountCoin
  /** Transaction messages in Amino format */
  msgs: CosmosMsgInput[]
  /** Fee specification (required for SignAmino) */
  fee: CosmosFeeInput
  /** Optional transaction memo */
  memo?: string
}

/**
 * Input for SignDirect transaction preparation
 *
 * SignDirect uses the modern Protobuf signing format, which is more
 * efficient and type-safe. Use this when you have pre-encoded transaction
 * bytes or need exact control over the transaction structure.
 *
 * @example
 * ```typescript
 * const input: SignDirectInput = {
 *   chain: Chain.Cosmos,
 *   coin: {
 *     chain: Chain.Cosmos,
 *     address: 'cosmos1...',
 *     decimals: 6,
 *     ticker: 'ATOM',
 *   },
 *   bodyBytes: 'base64EncodedTxBody...',
 *   authInfoBytes: 'base64EncodedAuthInfo...',
 *   chainId: 'cosmoshub-4',
 *   accountNumber: '12345',
 * }
 * ```
 */
export type SignDirectInput = {
  /** Cosmos chain to sign for */
  chain: CosmosChain
  /** Sender coin with address info */
  coin: AccountCoin
  /** Base64-encoded TxBody protobuf bytes */
  bodyBytes: string
  /** Base64-encoded AuthInfo protobuf bytes */
  authInfoBytes: string
  /** Chain ID (e.g., 'cosmoshub-4', 'osmosis-1') */
  chainId: string
  /** Account number as string (required for signing) */
  accountNumber: string
  /** Optional transaction memo (if not encoded in bodyBytes) */
  memo?: string
}

/**
 * Common options for Cosmos signing operations
 */
export type CosmosSigningOptions = {
  /**
   * Skip automatic chain-specific data fetching.
   * When true, uses only provided values without querying the chain.
   * Useful for offline signing or when you have pre-fetched data.
   */
  skipChainSpecificFetch?: boolean
}
