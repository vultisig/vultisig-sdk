import { create } from '@bufbuild/protobuf'
import { isChainOfKind } from '../../../../chain/ChainKind'
import { AccountCoin } from '../../../../chain/coin/AccountCoin'
import { getCoinBalance } from '../../../../chain/coin/balance'
import { getChainSpecific } from '../../../../mpc/keysign/chainSpecific'
import { FeeSettings } from '../../../../mpc/keysign/chainSpecific/FeeSettings'
import { refineKeysignAmount } from '../../../../mpc/keysign/refine/amount'
import { refineKeysignUtxo } from '../../../../mpc/keysign/refine/utxo'
import { getKeysignUtxoInfo } from '../../../../mpc/keysign/utxo/getKeysignUtxoInfo'
import { MpcLib } from '../../../../mpc/mpcLib'
import { toCommCoin } from '../../../../mpc/types/utils/commCoin'
import { KeysignPayloadSchema } from '../../../../mpc/types/vultisig/keysign/v1/keysign_message_pb'
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
