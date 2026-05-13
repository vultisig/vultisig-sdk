import { Buffer } from 'buffer'
import { create } from '@bufbuild/protobuf'
import { isChainOfKind } from '@vultisig/core-chain/ChainKind'
import { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import { getCoinBalance } from '@vultisig/core-chain/coin/balance'
import { getChainSpecific } from '@vultisig/core-mpc/keysign/chainSpecific'
import { FeeSettings } from '@vultisig/core-mpc/keysign/chainSpecific/FeeSettings'
import { refineKeysignAmount } from '@vultisig/core-mpc/keysign/refine/amount'
import { refineKeysignUtxo } from '@vultisig/core-mpc/keysign/refine/utxo'
import { getKeysignUtxoInfo } from '@vultisig/core-mpc/keysign/utxo/getKeysignUtxoInfo'
import { KeysignLibType } from '@vultisig/core-mpc/mpcLib'
import { toCommCoin } from '@vultisig/core-mpc/types/utils/commCoin'
import { TransactionType } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { WalletCore } from '@trustwallet/wallet-core'
import { PublicKey } from '@trustwallet/wallet-core/dist/src/wallet-core'

import { getCosmosWasmTokenTransferPayload } from './cosmosWasm'

export type BuildSendKeysignPayloadInput = {
  coin: AccountCoin
  receiver: string
  amount: bigint
  memo?: string
  vaultId: string
  localPartyId: string
  publicKey: PublicKey | null
  /** When `publicKey` is null (e.g. MLDSA-only chain), supply raw hex for `coin.hexPublicKey`. */
  hexPublicKeyOverride?: string
  libType: KeysignLibType
  walletCore: WalletCore
  feeSettings?: FeeSettings
}

export const buildSendKeysignPayload = async ({
  coin,
  receiver,
  amount,
  memo,
  vaultId,
  localPartyId,
  publicKey,
  hexPublicKeyOverride,
  walletCore,
  libType,
  feeSettings,
}: BuildSendKeysignPayloadInput) => {
  const hexPublicKey = hexPublicKeyOverride ?? (publicKey ? Buffer.from(publicKey.data()).toString('hex') : undefined)
  if (!hexPublicKey) {
    throw new Error('buildSendKeysignPayload requires publicKey or hexPublicKeyOverride')
  }

  const cosmosWasmTokenTransferPayload = getCosmosWasmTokenTransferPayload({
    coin,
    receiver,
    amount,
  })

  let keysignPayload = create(KeysignPayloadSchema, {
    coin: toCommCoin({
      ...coin,
      hexPublicKey,
    }),
    toAddress: receiver,
    toAmount: amount.toString(),
    memo,
    vaultLocalPartyId: localPartyId,
    vaultPublicKeyEcdsa: vaultId,
    libType,
    utxoInfo: await getKeysignUtxoInfo(coin),
    contractPayload: cosmosWasmTokenTransferPayload
      ? {
          case: 'wasmExecuteContractPayload',
          value: cosmosWasmTokenTransferPayload,
        }
      : undefined,
  })

  keysignPayload.blockchainSpecific = cosmosWasmTokenTransferPayload
    ? await getChainSpecific({
        keysignPayload,
        walletCore,
        transactionType: TransactionType.GENERIC_CONTRACT,
      })
    : await getChainSpecific({
        keysignPayload,
        feeSettings,
        walletCore,
      })

  const balance = await getCoinBalance(coin)

  if (publicKey) {
    keysignPayload = refineKeysignAmount({
      keysignPayload,
      walletCore,
      publicKey,
      balance,
    })

    if (isChainOfKind(coin.chain, 'utxo')) {
      keysignPayload = refineKeysignUtxo({
        keysignPayload,
        walletCore,
        publicKey,
      })
    }
  }

  return keysignPayload
}
