import { suiGasBudget } from '@vultisig/core-chain/chains/sui/config'
import { SuiCoin } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { TW } from '@trustwallet/wallet-core'
import Long from 'long'

import { getBlockchainSpecificValue } from '../../chainSpecific/KeysignChainSpecific'
import { getKeysignCoin } from '../../utils/getKeysignCoin'
import { SigningInputsResolver } from '../resolver'

const suiContractAddress = '0x2::sui::SUI'

export const getSuiSigningInputs: SigningInputsResolver<'sui'> = ({ keysignPayload }) => {
  const coin = getKeysignCoin(keysignPayload)

  // dApp-supplied PTBs (Sui Wallet Standard) arrive already BCS-serialized in
  // `signData.signSui`. WalletCore signs them verbatim via `signDirectMessage`
  // — coins, gas and recipients are already baked into the bytes, so we never
  // reconstruct a Pay / PaySui input for this path.
  if (keysignPayload.signData.case === 'signSui') {
    const { unsignedTxMsg } = keysignPayload.signData.value
    return [
      TW.Sui.Proto.SigningInput.create({
        signer: coin.address,
        signDirectMessage: TW.Sui.Proto.SignDirect.create({
          unsignedTxMsg,
        }),
      }),
    ]
  }

  // Sui has no native memo concept — a transaction is a Programmable
  // Transaction Block with no memo field. Rather than silently dropping a
  // memo, fail loudly so callers don't assume it was attached.
  if (keysignPayload.memo) {
    throw new Error('Sui transactions do not support a memo')
  }

  const { coins, referenceGasPrice, gasBudget } = getBlockchainSpecificValue(
    keysignPayload.blockchainSpecific,
    'suicheSpecific'
  )

  const coinType = coin.id || suiContractAddress

  const createObjectRef = (coin: SuiCoin) =>
    TW.Sui.Proto.ObjectRef.create({
      objectDigest: coin.digest,
      objectId: coin.coinObjectId,
      version: Long.fromString(coin.version),
    })

  const gasCoins = coins.filter(c => c.coinType === suiContractAddress).map(createObjectRef)

  const baseInput = {
    referenceGasPrice: Long.fromString(referenceGasPrice),
    signer: coin.address,
    gasBudget: gasBudget ? Long.fromString(gasBudget) : Long.fromBigInt(suiGasBudget),
  }

  const inputCoins = coins.filter(c => c.coinType === coinType).map(createObjectRef)

  if (coin.id) {
    return [
      TW.Sui.Proto.SigningInput.create({
        ...baseInput,
        pay: TW.Sui.Proto.Pay.create({
          gas: gasCoins[0],
          inputCoins: inputCoins,
          recipients: [keysignPayload.toAddress],
          amounts: [Long.fromString(keysignPayload.toAmount)],
        }),
      }),
    ]
  }

  return [
    TW.Sui.Proto.SigningInput.create({
      ...baseInput,
      paySui: TW.Sui.Proto.PaySui.create({
        inputCoins: inputCoins,
        recipients: [keysignPayload.toAddress],
        amounts: [Long.fromString(keysignPayload.toAmount)],
      }),
    }),
  ]
}
