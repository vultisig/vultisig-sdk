/**
 * Cosmos Payload Builders
 *
 * Functions to build KeysignPayload for SignAmino and SignDirect signing modes.
 * These use the internal core types to construct properly formatted payloads.
 */

import { create } from '@bufbuild/protobuf'
import { CosmosChain, IbcEnabledCosmosChain } from '@vultisig/core-chain/Chain'
import { getCosmosAccountInfo } from '@vultisig/core-chain/chains/cosmos/account/getCosmosAccountInfo'
import { cosmosGasRecord, getCosmosFeeAmount } from '@vultisig/core-chain/chains/cosmos/gas'
import { getCosmosChainKind } from '@vultisig/core-chain/chains/cosmos/utils/getCosmosChainKind'
import type { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import { KeysignLibType } from '@vultisig/core-mpc/mpcLib'
import { toCommCoin } from '@vultisig/core-mpc/types/utils/commCoin'
import {
  CosmosSpecificSchema,
  MAYAChainSpecificSchema,
  THORChainSpecificSchema,
} from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { KeysignPayload, KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import {
  CosmosCoinSchema,
  CosmosFeeSchema,
  CosmosMsgSchema,
  SignAminoSchema,
  SignDirectSchema,
} from '@vultisig/core-mpc/types/vultisig/keysign/v1/wasm_execute_contract_payload_pb'

import type { CosmosFeeInput, CosmosMsgInput, SignAminoInput, SignDirectInput } from '../../../types/cosmos'
import { VaultError, VaultErrorCode } from '../../VaultError'

/**
 * Minimal public-key contract the Cosmos payload builders need — just the raw
 * key bytes, via `.data()`. Deliberately narrower than @trustwallet/wallet-core's
 * `PublicKey` so it's structurally compatible with both that type and RN's
 * `NativePublicKeyInstance` (@vultisig/walletcore-native), letting RN consumers
 * pass their native public key without a cast.
 */
export type CosmosBuilderPublicKey = {
  data(): Uint8Array
}

/**
 * Input parameters for building SignAmino keysign payload
 */
export type BuildSignAminoPayloadInput = SignAminoInput & {
  vaultId: string
  localPartyId: string
  publicKey: CosmosBuilderPublicKey
  libType: KeysignLibType
  skipChainSpecificFetch?: boolean
  /** Pre-fetched account number. Required when `skipChainSpecificFetch`. sdk#1809. */
  accountNumber?: string
  /** Pre-fetched account sequence. Required when `skipChainSpecificFetch`. sdk#1809. */
  sequence?: string
}

/**
 * Input parameters for building SignDirect keysign payload
 */
export type BuildSignDirectPayloadInput = SignDirectInput & {
  vaultId: string
  localPartyId: string
  publicKey: CosmosBuilderPublicKey
  libType: KeysignLibType
  skipChainSpecificFetch?: boolean
  /** Pre-fetched account sequence. Required when `skipChainSpecificFetch`. sdk#1809. */
  sequence?: string
}

/**
 * sdk#1809: `skipChainSpecificFetch` advertises offline / pre-fetched signing,
 * but the account metadata it skips fetching used to fall back to `'0'`. A
 * Cosmos signature is bound to (account_number, sequence), so a zero default is
 * not a neutral placeholder - it produces a signature the chain rejects for any
 * account that has ever transacted. Fail closed and name the field instead.
 */
function requirePrefetched(builder: string, field: 'accountNumber' | 'sequence', value: string | undefined): string {
  if (value === undefined || value === '') {
    throw new VaultError(
      VaultErrorCode.InvalidConfig,
      `${builder}: ${field} is required when skipChainSpecificFetch is true. ` +
        `Pass the pre-fetched value (e.g. from getCosmosAccountInfo) - defaulting it to '0' would ` +
        `bind the signature to the wrong account state and the chain would reject the broadcast.`
    )
  }
  if (!/^[0-9]+$/.test(value)) {
    throw new VaultError(
      VaultErrorCode.InvalidConfig,
      `${builder}: ${field} must be a plain non-negative integer string, got ${JSON.stringify(value)}`
    )
  }
  return value
}

/**
 * Build blockchain-specific data for Cosmos chains
 */
async function buildCosmosBlockchainSpecific(
  chain: CosmosChain,
  coin: AccountCoin,
  accountNumber: string,
  sequence: string,
  fee?: CosmosFeeInput,
  skipChainSpecificFetch?: boolean
): Promise<KeysignPayload['blockchainSpecific']> {
  const chainKind = getCosmosChainKind(chain)

  if (chainKind === 'vaultBased') {
    // THORChain or MayaChain
    if (chain === 'THORChain') {
      const feeAmount = fee?.amount?.[0]?.amount
      if (fee && feeAmount == null) {
        throw new Error('THORChain fee.amount[0].amount is required when fee is provided')
      }

      return {
        case: 'thorchainSpecific',
        value: create(THORChainSpecificSchema, {
          accountNumber: BigInt(accountNumber),
          sequence: BigInt(sequence),
          fee: BigInt(feeAmount ?? 0),
        }),
      }
    } else {
      return {
        case: 'mayaSpecific',
        value: create(MAYAChainSpecificSchema, {
          accountNumber: BigInt(accountNumber),
          sequence: BigInt(sequence),
        }),
      }
    }
  }

  // IBC-enabled Cosmos chains
  return {
    case: 'cosmosSpecific',
    value: create(CosmosSpecificSchema, {
      accountNumber: BigInt(accountNumber),
      sequence: BigInt(sequence),
      gas: skipChainSpecificFetch
        ? cosmosGasRecord[chain as IbcEnabledCosmosChain]
        : await getCosmosFeeAmount(coin as AccountCoin<IbcEnabledCosmosChain>),
    }),
  }
}

/**
 * Build SignAmino signData from input
 */
function buildSignAminoData(msgs: CosmosMsgInput[], fee: CosmosFeeInput) {
  return {
    case: 'signAmino' as const,
    value: create(SignAminoSchema, {
      fee: create(CosmosFeeSchema, {
        amount: fee.amount.map(a =>
          create(CosmosCoinSchema, {
            denom: a.denom,
            amount: a.amount,
          })
        ),
        gas: fee.gas,
        payer: fee.payer,
        granter: fee.granter,
      }),
      msgs: msgs.map(m =>
        create(CosmosMsgSchema, {
          type: m.type,
          value: m.value,
        })
      ),
    }),
  }
}

/**
 * Build SignDirect signData from input
 */
function buildSignDirectData(bodyBytes: string, authInfoBytes: string, chainId: string, accountNumber: string) {
  return {
    case: 'signDirect' as const,
    value: create(SignDirectSchema, {
      bodyBytes,
      authInfoBytes,
      chainId,
      accountNumber,
    }),
  }
}

/**
 * Build a KeysignPayload for SignAmino (JSON/Amino) signing mode
 *
 * SignAmino is the legacy Cosmos signing format using JSON encoding.
 * It's widely supported across all Cosmos SDK chains.
 *
 * @param input - SignAmino payload parameters
 * @returns Complete KeysignPayload ready for signing
 */
export async function buildSignAminoKeysignPayload(input: BuildSignAminoPayloadInput): Promise<KeysignPayload> {
  const { chain, coin, msgs, fee, memo, vaultId, localPartyId, publicKey, libType, skipChainSpecificFetch } = input

  // Get account info from chain unless skipped. When skipped, the caller must
  // supply what the fetch would have returned (sdk#1809) — see requirePrefetched.
  let accountNumber: string
  let sequence: string

  if (skipChainSpecificFetch) {
    accountNumber = requirePrefetched('buildSignAminoKeysignPayload', 'accountNumber', input.accountNumber)
    sequence = requirePrefetched('buildSignAminoKeysignPayload', 'sequence', input.sequence)
  } else {
    const accountInfo = await getCosmosAccountInfo({
      chain,
      address: coin.address,
    })
    accountNumber = String(accountInfo.accountNumber)
    sequence = String(accountInfo.sequenceBigInt)
  }

  // Build the signData
  const signData = buildSignAminoData(msgs, fee)

  // Build blockchain-specific data
  const blockchainSpecific = await buildCosmosBlockchainSpecific(
    chain,
    coin,
    accountNumber,
    sequence,
    fee,
    skipChainSpecificFetch
  )

  // Create the payload
  return create(KeysignPayloadSchema, {
    coin: toCommCoin({
      ...coin,
      hexPublicKey: Buffer.from(publicKey.data()).toString('hex'),
    }),
    toAddress: '', // Not used for custom messages
    toAmount: '0',
    memo,
    vaultLocalPartyId: localPartyId,
    vaultPublicKeyEcdsa: vaultId,
    libType,
    blockchainSpecific,
    signData,
  })
}

/**
 * Build a KeysignPayload for SignDirect (Protobuf) signing mode
 *
 * SignDirect is the modern Cosmos signing format using Protobuf encoding.
 * It's more efficient and provides better type safety.
 *
 * @param input - SignDirect payload parameters
 * @returns Complete KeysignPayload ready for signing
 */
export async function buildSignDirectKeysignPayload(input: BuildSignDirectPayloadInput): Promise<KeysignPayload> {
  const {
    chain,
    coin,
    bodyBytes,
    authInfoBytes,
    chainId,
    accountNumber,
    memo,
    vaultId,
    localPartyId,
    publicKey,
    libType,
    skipChainSpecificFetch,
  } = input

  // Get sequence from chain unless skipped. When skipped, the caller must
  // supply what the fetch would have returned (sdk#1809). `accountNumber` is
  // already part of the SignDirect input, so only `sequence` is needed here.
  let sequence: string

  if (skipChainSpecificFetch) {
    sequence = requirePrefetched('buildSignDirectKeysignPayload', 'sequence', input.sequence)
  } else {
    const accountInfo = await getCosmosAccountInfo({
      chain,
      address: coin.address,
    })
    sequence = String(accountInfo.sequenceBigInt)
  }

  // Build the signData
  const signData = buildSignDirectData(bodyBytes, authInfoBytes, chainId, accountNumber)

  // Build blockchain-specific data
  const blockchainSpecific = await buildCosmosBlockchainSpecific(
    chain,
    coin,
    accountNumber,
    sequence,
    undefined,
    skipChainSpecificFetch
  )

  // Create the payload
  return create(KeysignPayloadSchema, {
    coin: toCommCoin({
      ...coin,
      hexPublicKey: Buffer.from(publicKey.data()).toString('hex'),
    }),
    toAddress: '', // Not used for custom messages
    toAmount: '0',
    memo,
    vaultLocalPartyId: localPartyId,
    vaultPublicKeyEcdsa: vaultId,
    libType,
    blockchainSpecific,
    signData,
  })
}
