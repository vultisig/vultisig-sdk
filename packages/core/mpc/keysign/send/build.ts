import { create } from '@bufbuild/protobuf'
import { isChainOfKind } from '../../../chain/ChainKind'
import { AccountCoin } from '../../../chain/coin/AccountCoin'
import { getCoinBalance } from '../../../chain/coin/balance'
import { isValidAddress } from '../../../chain/utils/isValidAddress'
import { getChainSpecific } from '../chainSpecific'
import { FeeSettings } from '../chainSpecific/FeeSettings'
import { refineKeysignAmount } from '../refine/amount'
import { refineKeysignUtxo } from '../refine/utxo'
import { getKeysignUtxoInfo } from '../utxo/getKeysignUtxoInfo'
import { MpcLib } from '../../mpcLib'
import { toCommCoin } from '../../types/utils/commCoin'
import { KeysignPayloadSchema } from '../../types/vultisig/keysign/v1/keysign_message_pb'
import { WalletCore } from '@trustwallet/wallet-core'
import { PublicKey } from '@trustwallet/wallet-core/dist/src/wallet-core'

export type BuildSendKeysignPayloadInput = {
  coin: AccountCoin
  receiver: string
  amount: bigint
  memo?: string
  vaultId: string
  localPartyId: string
  publicKey: PublicKey
  libType: MpcLib
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
  walletCore,
  libType,
  feeSettings,
}: BuildSendKeysignPayloadInput) => {
  // Validate receiver address format
  const isValid = isValidAddress({
    chain: coin.chain,
    address: receiver,
    walletCore,
  })

  if (!isValid) {
    throw new Error(
      `Invalid receiver address format for ${coin.chain}: ${receiver}`
    )
  }

  // Validate amount
  if (amount <= 0n) {
    throw new Error('Amount must be greater than zero')
  }

  let keysignPayload = create(KeysignPayloadSchema, {
    coin: toCommCoin({
      ...coin,
      hexPublicKey: Buffer.from(publicKey.data()).toString('hex'),
    }),
    toAddress: receiver,
    toAmount: amount.toString(),
    memo,
    vaultLocalPartyId: localPartyId,
    vaultPublicKeyEcdsa: vaultId,
    libType,
    utxoInfo: await getKeysignUtxoInfo(coin),
  })

  keysignPayload.blockchainSpecific = await getChainSpecific({
    keysignPayload,
    feeSettings,
    walletCore,
  })

  const balance = await getCoinBalance(coin)

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

  return keysignPayload
}
