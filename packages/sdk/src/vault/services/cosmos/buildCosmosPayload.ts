/**
 * Cosmos Payload Builders
 *
 * Functions to build KeysignPayload for SignAmino and SignDirect signing modes.
 * These use the internal core types to construct properly formatted payloads.
 */

import { create } from '@bufbuild/protobuf'
import { CosmosChain } from '@core/chain/Chain'
import { getCosmosAccountInfo } from '@core/chain/chains/cosmos/account/getCosmosAccountInfo'
import { cosmosGasRecord } from '@core/chain/chains/cosmos/gas'
import { getCosmosChainKind } from '@core/chain/chains/cosmos/utils/getCosmosChainKind'
import { KeysignLibType } from '@core/mpc/mpcLib'
import { toCommCoin } from '@core/mpc/types/utils/commCoin'
import {
  CosmosSpecificSchema,
  MAYAChainSpecificSchema,
  THORChainSpecificSchema,
} from '@core/mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { KeysignPayload, KeysignPayloadSchema } from '@core/mpc/types/vultisig/keysign/v1/keysign_message_pb'
import {
  CosmosCoinSchema,
  CosmosFeeSchema,
  CosmosMsgSchema,
  SignAminoSchema,
  SignDirectSchema,
} from '@core/mpc/types/vultisig/keysign/v1/wasm_execute_contract_payload_pb'
import { PublicKey } from '@trustwallet/wallet-core/dist/src/wallet-core'

import type { CosmosFeeInput, CosmosMsgInput, SignAminoInput, SignDirectInput } from '../../../types/cosmos'

/**
 * Input parameters for building SignAmino keysign payload
 */
export type BuildSignAminoPayloadInput = SignAminoInput & {
  vaultId: string
  localPartyId: string
  publicKey: PublicKey
  libType: KeysignLibType
  skipChainSpecificFetch?: boolean
}

/**
 * Input parameters for building SignDirect keysign payload
 */
export type BuildSignDirectPayloadInput = SignDirectInput & {
  vaultId: string
  localPartyId: string
  publicKey: PublicKey
  libType: KeysignLibType
  skipChainSpecificFetch?: boolean
}

/**
 * Build blockchain-specific data for Cosmos chains
 */
async function buildCosmosBlockchainSpecific(
  chain: CosmosChain,
  accountNumber: string,
  sequence: string
): Promise<KeysignPayload['blockchainSpecific']> {
  const chainKind = getCosmosChainKind(chain)

  if (chainKind === 'vaultBased') {
    // THORChain or MayaChain
    if (chain === 'THORChain') {
      return {
        case: 'thorchainSpecific',
        value: create(THORChainSpecificSchema, {
          accountNumber: BigInt(accountNumber),
          sequence: BigInt(sequence),
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
      gas: cosmosGasRecord[chain as keyof typeof cosmosGasRecord],
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

  // Get account info from chain unless skipped
  let accountNumber = '0'
  let sequence = '0'

  if (!skipChainSpecificFetch) {
    const accountInfo = await getCosmosAccountInfo(coin)
    accountNumber = accountInfo.accountNumber
    sequence = accountInfo.sequence
  }

  // Build the signData
  const signData = buildSignAminoData(msgs, fee)

  // Build blockchain-specific data
  const blockchainSpecific = await buildCosmosBlockchainSpecific(chain, accountNumber, sequence)

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

  // Get sequence from chain unless skipped
  let sequence = '0'

  if (!skipChainSpecificFetch) {
    const accountInfo = await getCosmosAccountInfo(coin)
    sequence = accountInfo.sequence
  }

  // Build the signData
  const signData = buildSignDirectData(bodyBytes, authInfoBytes, chainId, accountNumber)

  // Build blockchain-specific data
  const blockchainSpecific = await buildCosmosBlockchainSpecific(chain, accountNumber, sequence)

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
