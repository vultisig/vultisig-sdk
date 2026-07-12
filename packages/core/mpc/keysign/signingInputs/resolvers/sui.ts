import { suiGasBudget } from '@vultisig/core-chain/chains/sui/config'
import { SuiCoin } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { TW } from '@trustwallet/wallet-core'
import Long from 'long'

import {
  isNativeSuiCoinType,
  selectSuiGasObject,
  selectSuiInputCoins,
  suiCoinTypesMatch,
} from '../../../chains/sui/coinSelection'
import { getBlockchainSpecificValue } from '../../chainSpecific/KeysignChainSpecific'
import { getKeysignCoin } from '../../utils/getKeysignCoin'
import { SigningInputsResolver } from '../resolver'

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

  const createObjectRef = (coin: SuiCoin) =>
    TW.Sui.Proto.ObjectRef.create({
      objectDigest: coin.digest,
      objectId: coin.coinObjectId,
      version: Long.fromString(coin.version),
    })

  const budget = gasBudget ? BigInt(gasBudget) : suiGasBudget

  const baseInput = {
    referenceGasPrice: Long.fromString(referenceGasPrice),
    signer: coin.address,
    gasBudget: Long.fromString(budget.toString()),
  }

  const amount = BigInt(keysignPayload.toAmount)

  // Coin selection is deterministic and MUST match iOS (#4734) / Android
  // (#3989) exactly — every co-signing device recomputes these inputs from the
  // shared payload, and any divergence in the selected set diverges the
  // sighash and fails the ceremony. See chains/sui/coinSelection.ts.

  if (coin.id) {
    // Token send (Pay): covering-select the token objects; a SINGLE native SUI
    // object pays gas (Pay's gas field is not gas-smashed like PaySui), so pick
    // one that actually covers the budget instead of whatever the RPC returned
    // first — the old `gasCoins[0]` failed with plenty of SUI in other objects.
    const tokenType = coin.id
    const tokenCoins = coins.filter(c => suiCoinTypesMatch(c.coinType, tokenType))
    if (tokenCoins.length === 0) {
      throw new Error('Non-native token transaction requires the token to be present')
    }
    const gasObject = selectSuiGasObject(coins, budget)
    if (!gasObject) {
      throw new Error('Non-native token transaction requires at least one SUI coin for gas fees')
    }

    return [
      TW.Sui.Proto.SigningInput.create({
        ...baseInput,
        pay: TW.Sui.Proto.Pay.create({
          gas: createObjectRef(gasObject),
          inputCoins: selectSuiInputCoins(tokenCoins, amount).map(createObjectRef),
          recipients: [keysignPayload.toAddress],
          amounts: [Long.fromString(keysignPayload.toAmount)],
        }),
      }),
    ]
  }

  // Native send (PaySui): reference only the largest objects covering
  // amount + gas. PaySui's whole input set is the gas payment, which Sui
  // gas-smashes into one coin — a scattered balance is still merged, but the
  // transaction stays within Sui's 128 KiB size / 256-gas-object limits
  // instead of referencing every object and failing at broadcast.
  const nativeCoins = coins.filter(c => isNativeSuiCoinType(c.coinType))
  if (nativeCoins.length === 0) {
    throw new Error('Native token transaction requires at least one SUI coin')
  }

  return [
    TW.Sui.Proto.SigningInput.create({
      ...baseInput,
      paySui: TW.Sui.Proto.PaySui.create({
        inputCoins: selectSuiInputCoins(nativeCoins, amount + budget).map(createObjectRef),
        recipients: [keysignPayload.toAddress],
        amounts: [Long.fromString(keysignPayload.toAmount)],
      }),
    }),
  ]
}
