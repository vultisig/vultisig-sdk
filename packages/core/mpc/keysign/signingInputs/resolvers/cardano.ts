import { fromCardanoAssetId } from '@vultisig/core-chain/chains/cardano/asset/cardanoAssetId'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'
import { stripHexPrefix } from '@vultisig/lib-utils/hex/stripHexPrefix'
import { TW } from '@trustwallet/wallet-core'
import Long from 'long'

import { getBlockchainSpecificValue } from '../../chainSpecific/KeysignChainSpecific'
import { SigningInputsResolver } from '../resolver'

/** Encodes a token amount as big-endian bytes for WalletCore's Cardano proto. */
const amountToBytes = (amount: bigint): Uint8Array => {
  const hex = amount.toString(16)
  const padded = hex.length % 2 === 0 ? hex : `0${hex}`
  return Uint8Array.from(Buffer.from(padded, 'hex'))
}

export const getCardanoSigningInputs: SigningInputsResolver<'cardano'> = ({
  keysignPayload,
  walletCore,
}) => {
  const { sendMaxAmount, ttl } = getBlockchainSpecificValue(
    keysignPayload.blockchainSpecific,
    'cardano'
  )

  const coin = shouldBePresent(keysignPayload.coin)
  const isTokenSend = coin.contractAddress !== ''

  const tokenBundle = isTokenSend
    ? (() => {
        const { policyId, assetName } = fromCardanoAssetId(
          coin.contractAddress
        )

        return TW.Cardano.Proto.TokenBundle.create({
          token: [
            TW.Cardano.Proto.TokenAmount.create({
              policyId,
              assetNameHex: assetName,
              amount: amountToBytes(BigInt(keysignPayload.toAmount)),
            }),
          ],
        })
      })()
    : undefined

  const input = TW.Cardano.Proto.SigningInput.create({
    transferMessage: TW.Cardano.Proto.Transfer.create({
      toAddress: keysignPayload.toAddress,
      changeAddress: coin.address,
      amount: Long.fromString(keysignPayload.toAmount),
      useMaxAmount: sendMaxAmount,
      tokenAmount: tokenBundle,
    }),
    ttl: Long.fromString(ttl.toString()),

    utxos: keysignPayload.utxoInfo.map(({ hash, amount, index }) =>
      TW.Cardano.Proto.TxInput.create({
        outPoint: TW.Cardano.Proto.OutPoint.create({
          txHash: walletCore.HexCoding.decode(stripHexPrefix(hash)),
          outputIndex: Long.fromString(index.toString()),
        }),
        amount: Long.fromString(amount.toString()),
        address: coin.address,
      })
    ),
  })

  return [input]
}
