import type { TransactionType } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { Resolver } from '@vultisig/lib-utils/types/Resolver'
import { WalletCore } from '@trustwallet/wallet-core'
import { Psbt } from 'bitcoinjs-lib'

import { KeysignPayload } from '../../types/vultisig/keysign/v1/keysign_message_pb'
import { FeeSettings } from './FeeSettings'
import { KeysignChainSpecific, KeysignChainSpecificKey } from './KeysignChainSpecific'

type ValueForCase<C extends KeysignChainSpecificKey> = Extract<KeysignChainSpecific, { case: C }>['value']

export type GetChainSpecificInput<C extends KeysignChainSpecificKey = KeysignChainSpecificKey> = {
  keysignPayload: KeysignPayload
  walletCore: WalletCore
  /** XRPL DestinationTag, carried in RippleSpecific for Ripple payments. */
  destinationTag?: number
  /**
   * Whether the caller's UI offered this as a MAX send, carried in TonSpecific.
   * Must come from the flow that drew the button — inferring it from the amount
   * mislabels an ordinary send that happens to sit close to the balance.
   */
  sendMaxAmount?: boolean
} & (C extends 'ethereumSpecific'
  ? {
      feeSettings?: FeeSettings<'evm'>
      thirdPartyGasLimitEstimation?: bigint
    }
  : C extends 'utxoSpecific'
    ? { feeSettings?: FeeSettings<'utxo'>; psbt?: Psbt }
    : C extends 'cosmosSpecific'
      ? {
          timeoutTimestamp?: string
          transactionType?: TransactionType
          isDeposit?: boolean
        }
      : C extends 'thorchainSpecific'
        ? {
            isDeposit?: boolean
            transactionType?: TransactionType
          }
        : C extends 'mayaSpecific'
          ? {
              isDeposit?: boolean
            }
          : C extends 'tronSpecific'
            ? {
                expiration?: number
                timestamp?: number
                refBlockBytesHex?: string
                refBlockHashHex?: string
                thirdPartyGasLimitEstimation?: bigint
              }
            : C extends 'tonSpecific'
              ? {
                  /**
                   * Deadline (unix seconds) a dApp attached to the request — a TonConnect
                   * `sendTransaction` `valid_until`. Caps the wallet's own expiry; a deadline
                   * already in the past fails the build instead of signing a dead transaction.
                   */
                  validUntil?: number
                }
              : {})

export type GetChainSpecificResolver<C extends KeysignChainSpecificKey = KeysignChainSpecificKey> = Resolver<
  GetChainSpecificInput<C>,
  Promise<ValueForCase<C>>
>
