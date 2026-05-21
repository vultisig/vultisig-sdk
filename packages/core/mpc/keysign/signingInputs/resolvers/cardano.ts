import { Buffer } from 'buffer'
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

export const getCardanoSigningInputs: SigningInputsResolver<'cardano'> = ({ keysignPayload, walletCore }) => {
  // Cardano memos require CIP-20 auxiliary data whose hash is committed to in the
  // signed tx body — they cannot be attached after signing. Until that path is
  // implemented (see vultisig/vultisig-sdk#432), fail loudly instead of silently
  // dropping the memo and producing a tx with `auxiliary_data = null`.
  if (keysignPayload.memo) {
    throw new Error(
      'Cardano memo is not supported yet: this SDK cannot attach CIP-20 metadata to direct sends, so the memo would be dropped and never land on-chain. Please retry without a memo, or wait for CIP-20 support (vultisig/vultisig-sdk#432).'
    )
  }

  const { sendMaxAmount, ttl, byteFee } = getBlockchainSpecificValue(keysignPayload.blockchainSpecific, 'cardano')

  const coin = shouldBePresent(keysignPayload.coin)
  const isTokenSend = coin.contractAddress !== ''

  const tokenBundle = isTokenSend
    ? (() => {
        const { policyId, assetName } = fromCardanoAssetId(coin.contractAddress)

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
      forceFee: Long.fromString(byteFee.toString()),
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
