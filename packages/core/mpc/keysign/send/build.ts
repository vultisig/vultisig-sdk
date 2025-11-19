import { create } from '@bufbuild/protobuf'
import { isChainOfKind } from '../../../chain/ChainKind'
import { AccountCoin } from '../../../chain/coin/AccountCoin'
import { getCoinBalance } from '../../../chain/coin/balance'
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
import { isAddress } from 'viem'
import { BuildKeysignPayloadError } from '../error'

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
  // Validate Ethereum addresses
  if (isChainOfKind(coin.chain, 'evm') && !isAddress(receiver)) {
    throw new BuildKeysignPayloadError('invalid-address')
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
