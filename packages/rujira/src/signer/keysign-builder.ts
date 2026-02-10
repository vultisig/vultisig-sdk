/**
 * Keysign payload builder for withdrawal transactions
 * @module signer/keysign-builder
 */

import { create } from '@bufbuild/protobuf'
import { KeysignPayloadSchema } from '@vultisig/sdk'

import { THORCHAIN_TO_SDK_CHAIN } from '../config.js'
import { THORCHAIN_DECIMALS } from '../config/constants.js'
import type { PreparedWithdraw } from '../modules/withdraw.js'
import { parseAsset } from '../utils/denom-conversion.js'
import { base64Encode } from '../utils/encoding.js'
import type { KeysignPayload, VultisigVault } from './types.js'

export type KeysignBuildParams = {
  vault: VultisigVault
  senderAddress: string
  prepared: PreparedWithdraw
  accountInfo: { accountNumber: string; sequence: string }
  fee: bigint
}

/**
 * Build a keysign payload for a withdrawal transaction.
 */
export async function buildWithdrawalKeysignPayload(params: KeysignBuildParams): Promise<KeysignPayload> {
  const { vault, senderAddress, prepared, accountInfo, fee } = params

  const { chain: thorchainChainId, symbol: fullSymbol } = parseAsset(prepared.asset)
  const ticker = fullSymbol.split('-')[0] || fullSymbol

  const l1Chain = THORCHAIN_TO_SDK_CHAIN[thorchainChainId] || thorchainChainId

  const basePayload = await vault.prepareSignDirectTx(
    {
      chain: 'THORChain',
      coin: {
        chain: 'THORChain',
        address: senderAddress,
        decimals: THORCHAIN_DECIMALS,
        ticker: 'RUNE',
      },
      bodyBytes: base64Encode('dummy'),
      authInfoBytes: base64Encode('dummy'),
      chainId: 'thorchain-1',
      accountNumber: accountInfo.accountNumber,
      memo: prepared.memo,
    },
    { skipChainSpecificFetch: true }
  )

  const derivedPublicKey = basePayload.coin?.hexPublicKey || vault.publicKeys.ecdsa

  const contractAddress = fullSymbol.includes('-') ? fullSymbol.split('-')[1]?.toUpperCase() || '' : ''

  const keysignPayload = create(KeysignPayloadSchema, {
    coin: {
      chain: 'THORChain',
      ticker: 'RUNE',
      address: senderAddress,
      contractAddress: '',
      decimals: THORCHAIN_DECIMALS,
      priceProviderId: '',
      isNativeToken: true,
      hexPublicKey: derivedPublicKey,
      logo: '',
    },
    toAddress: '',
    toAmount: prepared.amount,
    blockchainSpecific: {
      case: 'thorchainSpecific',
      value: {
        accountNumber: BigInt(accountInfo.accountNumber),
        sequence: BigInt(accountInfo.sequence),
        fee: fee,
        isDeposit: true,
        transactionType: 0,
      },
    },
    memo: prepared.memo,
    vaultPublicKeyEcdsa: vault.publicKeys.ecdsa,
    vaultLocalPartyId: basePayload.vaultLocalPartyId || '',
    libType: basePayload.libType || 'GG20',
    utxoInfo: [],
    swapPayload: {
      case: 'thorchainSwapPayload',
      value: {
        fromAddress: senderAddress,
        fromCoin: {
          chain: l1Chain,
          ticker: ticker,
          contractAddress: contractAddress,
          decimals: THORCHAIN_DECIMALS,
          address: '',
          priceProviderId: '',
          isNativeToken: fullSymbol === ticker,
          hexPublicKey: '',
          logo: '',
        },
        toCoin: {
          chain: l1Chain,
          ticker: ticker,
          contractAddress: contractAddress,
          decimals: THORCHAIN_DECIMALS,
          address: prepared.destination,
          priceProviderId: '',
          isNativeToken: false,
          hexPublicKey: '',
          logo: '',
        },
        vaultAddress: '',
        routerAddress: '',
        fromAmount: prepared.amount,
        toAmountDecimal: '0',
        toAmountLimit: '0',
        streamingInterval: '0',
        streamingQuantity: '0',
        expirationTime: BigInt(0),
        isAffiliate: false,
        fee: '0',
      },
    },
    contractPayload: { case: undefined, value: undefined },
    signData: { case: undefined, value: undefined },
  })

  return keysignPayload
}
