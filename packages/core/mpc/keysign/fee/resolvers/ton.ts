import { estimateTonFee } from '@vultisig/core-chain/chains/ton/api'
import { tonConfig } from '@vultisig/core-chain/chains/ton/config'
import { CoinKey } from '@vultisig/core-chain/coin/Coin'
import { isFeeCoin } from '@vultisig/core-chain/coin/utils/isFeeCoin'
import { TW } from '@trustwallet/wallet-core'

import { getBlockchainSpecificValue } from '../../chainSpecific/KeysignChainSpecific'
import { getTonSigningInputs } from '../../signingInputs/resolvers/ton'
import { getTonJettonTransferAmount } from '../../signingInputs/resolvers/ton/jetton'
import { getKeysignCoin } from '../../utils/getKeysignCoin'
import { FeeAmountResolver } from '../resolver'

export const getTonFeeAmount = (coin: CoinKey, isActiveDestination = false) =>
  isFeeCoin(coin) ? tonConfig.baseFee : tonConfig.baseFee + getTonJettonTransferAmount(isActiveDestination)

const buildTonFeeEstimateBoc = async ({
  keysignPayload,
  walletCore,
  publicKey,
}: Parameters<FeeAmountResolver>[0]): Promise<string> => {
  const [signingInput] = await getTonSigningInputs({ keysignPayload, walletCore })
  if (!signingInput) {
    throw new Error('TON fee estimate produced no signing input')
  }

  const signatures = walletCore.DataVector.create()
  const publicKeys = walletCore.DataVector.create()

  try {
    // toncenter evaluates with `ignore_chksig: true`, so a zero signature is
    // sufficient. Compiling it through TransactionCompiler preserves the real
    // vault public key and StateInit, unlike signing with a throwaway key.
    signatures.add(new Uint8Array(64))
    publicKeys.add(publicKey.data())

    const compiled = walletCore.TransactionCompiler.compileWithSignatures(
      walletCore.CoinType.ton,
      TW.TheOpenNetwork.Proto.SigningInput.encode(signingInput).finish(),
      signatures,
      publicKeys
    )
    const output = TW.TheOpenNetwork.Proto.SigningOutput.decode(compiled)
    if (output.errorMessage) {
      throw new Error(`TON fee estimate compilation failed: ${output.errorMessage}`)
    }
    if (!output.encoded) {
      throw new Error('TON fee estimate compilation returned an empty BoC')
    }

    return output.encoded
  } finally {
    signatures.delete()
    publicKeys.delete()
  }
}

export const tonFeeAmountResolver: FeeAmountResolver = async input => {
  const coin = getKeysignCoin(input.keysignPayload)
  const isActiveDestination = isFeeCoin(coin)
    ? false
    : getBlockchainSpecificValue(input.keysignPayload.blockchainSpecific, 'tonSpecific').isActiveDestination
  const fallback = getTonFeeAmount(coin, isActiveDestination)

  try {
    const externalMessageBoc = await buildTonFeeEstimateBoc(input)
    const estimate = await estimateTonFee({ address: coin.address, externalMessageBoc })
    const requiredAmount = isFeeCoin(coin) ? estimate : estimate + getTonJettonTransferAmount(isActiveDestination)
    return requiredAmount > fallback ? requiredAmount : fallback
  } catch {
    return fallback
  }
}
