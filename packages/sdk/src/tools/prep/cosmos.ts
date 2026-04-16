import type { WalletCore } from '@trustwallet/wallet-core'
import { getPublicKey } from '@vultisig/core-chain/publicKey/getPublicKey'
import type { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'

import { getWalletCore } from '../../context/wasmRuntime'
import type { CosmosSigningOptions, SignAminoInput, SignDirectInput } from '../../types/cosmos'
import {
  buildSignAminoKeysignPayload,
  buildSignDirectKeysignPayload,
} from '../../vault/services/cosmos/buildCosmosPayload'
import type { VaultIdentity } from './types'

const COSMOS_CHAINS = [
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

const isCosmosChain = (chain: string): boolean => COSMOS_CHAINS.includes(chain)

/**
 * Build a SignAmino `KeysignPayload` from raw vault identity fields, without
 * requiring an instantiated vault. This is the vault-free equivalent of
 * `vault.transactionBuilder.prepareSignAminoTx()` and is intended for MCP
 * servers and other contexts where only the public identity (no key shares)
 * is available.
 *
 * SignAmino uses the legacy Amino (JSON) signing format, which is widely
 * supported across Cosmos SDK chains. Use this for governance votes,
 * staking operations, and other custom messages.
 *
 * @example
 * ```ts
 * const payload = await prepareSignAminoTxFromKeys(identity, {
 *   chain: 'Cosmos',
 *   coin: { chain: 'Cosmos', address: 'cosmos1...', decimals: 6, ticker: 'ATOM' },
 *   msgs: [{
 *     type: 'cosmos-sdk/MsgVote',
 *     value: JSON.stringify({
 *       proposal_id: '123',
 *       voter: 'cosmos1...',
 *       option: 'VOTE_OPTION_YES',
 *     }),
 *   }],
 *   fee: { amount: [{ denom: 'uatom', amount: '5000' }], gas: '200000' },
 * })
 * ```
 *
 * `walletCore` is optional; when omitted, falls back to the SDK's globally-configured
 * `getWalletCore()` (used by MCP / vault-free callers). Wrappers with an injected
 * `WasmProvider` should pass it explicitly.
 */
export const prepareSignAminoTxFromKeys = async (
  identity: VaultIdentity,
  input: SignAminoInput,
  options?: CosmosSigningOptions,
  walletCoreOverride?: WalletCore
): Promise<KeysignPayload> => {
  if (!isCosmosChain(input.chain)) {
    throw new Error(`Chain ${input.chain} does not support SignAmino. Use a Cosmos-SDK chain.`)
  }

  const walletCore = walletCoreOverride ?? (await getWalletCore())

  const publicKey = getPublicKey({
    chain: input.chain,
    walletCore,
    publicKeys: {
      ecdsa: identity.ecdsaPublicKey,
      eddsa: identity.eddsaPublicKey,
    },
    hexChainCode: identity.hexChainCode,
  })

  return buildSignAminoKeysignPayload({
    ...input,
    vaultId: identity.ecdsaPublicKey,
    localPartyId: identity.localPartyId,
    publicKey,
    libType: identity.libType,
    skipChainSpecificFetch: options?.skipChainSpecificFetch,
  })
}

/**
 * Build a SignDirect `KeysignPayload` from raw vault identity fields, without
 * requiring an instantiated vault. This is the vault-free equivalent of
 * `vault.transactionBuilder.prepareSignDirectTx()` and is intended for MCP
 * servers and other contexts where only the public identity (no key shares)
 * is available.
 *
 * SignDirect uses the modern Protobuf signing format, which is more
 * efficient and type-safe. Use this when you have pre-encoded transaction
 * bytes or need exact control over the transaction structure.
 *
 * @example
 * ```ts
 * const payload = await prepareSignDirectTxFromKeys(identity, {
 *   chain: 'Cosmos',
 *   coin: { chain: 'Cosmos', address: 'cosmos1...', decimals: 6, ticker: 'ATOM' },
 *   bodyBytes: encodedTxBodyBase64,
 *   authInfoBytes: encodedAuthInfoBase64,
 *   chainId: 'cosmoshub-4',
 *   accountNumber: '12345',
 * })
 * ```
 *
 * `walletCore` is optional; when omitted, falls back to the SDK's globally-configured
 * `getWalletCore()` (used by MCP / vault-free callers). Wrappers with an injected
 * `WasmProvider` should pass it explicitly.
 */
export const prepareSignDirectTxFromKeys = async (
  identity: VaultIdentity,
  input: SignDirectInput,
  options?: CosmosSigningOptions,
  walletCoreOverride?: WalletCore
): Promise<KeysignPayload> => {
  if (!isCosmosChain(input.chain)) {
    throw new Error(`Chain ${input.chain} does not support SignDirect. Use a Cosmos-SDK chain.`)
  }

  const walletCore = walletCoreOverride ?? (await getWalletCore())

  const publicKey = getPublicKey({
    chain: input.chain,
    walletCore,
    publicKeys: {
      ecdsa: identity.ecdsaPublicKey,
      eddsa: identity.eddsaPublicKey,
    },
    hexChainCode: identity.hexChainCode,
  })

  return buildSignDirectKeysignPayload({
    ...input,
    vaultId: identity.ecdsaPublicKey,
    localPartyId: identity.localPartyId,
    publicKey,
    libType: identity.libType,
    skipChainSpecificFetch: options?.skipChainSpecificFetch,
  })
}
