import { Buffer } from 'buffer'
import { assertSafeSolanaSwapTransactionBase64 } from '@vultisig/core-chain/chains/solana/assertSafeSolanaSwapInstructions'
import { getCoinType } from '@vultisig/core-chain/coin/coinType'
import { assertField } from '@vultisig/lib-utils/record/assertField'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'
import { matchRecordUnion } from '@vultisig/lib-utils/matchRecordUnion'
import { PublicKey } from '@solana/web3.js'
import { TW } from '@trustwallet/wallet-core'

import { getBlockchainSpecificValue } from '../../../chainSpecific/KeysignChainSpecific'
import { getKeysignSwapPayload } from '../../../swap/getKeysignSwapPayload'
import { getKeysignChain } from '../../../utils/getKeysignChain'
import { SigningInputsResolver } from '../../resolver'
import { getSolanaSendSigningInput } from './send'

export const getSolanaSigningInputs: SigningInputsResolver<'solana'> = ({ keysignPayload, walletCore }) => {
  const chain = getKeysignChain(keysignPayload)

  const { recentBlockHash } = getBlockchainSpecificValue(keysignPayload.blockchainSpecific, 'solanaSpecific')

  if (keysignPayload.signData.case === 'signSolana') {
    const coinType = getCoinType({ walletCore, chain })
    const inputs = keysignPayload.signData.value.rawTransactions.map(transaction => {
      const decodedData = walletCore.TransactionDecoder.decode(coinType, Buffer.from(transaction, 'base64'))
      const decodedTransaction = TW.Solana.Proto.DecodingTransactionOutput.decode(decodedData)
      if (!decodedTransaction.transaction) {
        throw new Error("Can't decode transaction")
      }
      const rawMessage = decodedTransaction.transaction

      return TW.Solana.Proto.SigningInput.create({
        rawMessage,
      })
    })
    return inputs
  }

  const swapPayload = getKeysignSwapPayload(keysignPayload)

  if (swapPayload) {
    return matchRecordUnion(swapPayload, {
      native: () => [getSolanaSendSigningInput({ keysignPayload, walletCore })],
      general: async swapPayload => {
        const tx = shouldBePresent(swapPayload.quote?.tx)
        const { data } = tx

        // sdk#1358 fund-safety: re-run the Jupiter program allow-list + fund-movement guard HERE, on
        // the co-signer signing-input path, not only at quote construction. Every co-signer (e.g.
        // VultiServer in a 2-of-2) independently rebuilds this input from the shared KeysignPayload and
        // signs it verbatim (only recentBlockhash is overwritten below), so a compromised initiator
        // could otherwise slip a drain instruction into swapPayload.quote.tx.data that no co-signer ever
        // validated. This is a PURE gate - it throws (fail-closed, like the Ripple resolver) or no-ops,
        // and never touches the bytes that get signed, so it cannot desync the cross-device pre-signing
        // hash. userWallet is the signing vault's own Solana address (coin.address).
        const userWallet = new PublicKey(assertField(keysignPayload, 'coin').address)
        await assertSafeSolanaSwapTransactionBase64(data, userWallet)

        const decodedData = walletCore.TransactionDecoder.decode(
          getCoinType({
            walletCore,
            chain,
          }),
          Buffer.from(data, 'base64')
        )
        const { transaction } = TW.Solana.Proto.DecodingTransactionOutput.decode(decodedData)

        if (!transaction) {
          throw new Error("Can't decode swap transaction")
        }

        if (transaction.legacy) {
          transaction.legacy.recentBlockhash = recentBlockHash
        } else if (transaction.v0) {
          transaction.v0.recentBlockhash = recentBlockHash
        }

        const signingInput = TW.Solana.Proto.SigningInput.create({
          v0Msg: true,
          recentBlockhash: recentBlockHash,
          rawMessage: transaction,
        })

        return [signingInput]
      },
    })
  }

  return [getSolanaSendSigningInput({ keysignPayload, walletCore })]
}
