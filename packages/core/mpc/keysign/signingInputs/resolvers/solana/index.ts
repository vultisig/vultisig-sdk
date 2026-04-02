import { getCoinType } from '@vultisig/core-chain/coin/coinType'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'
import { matchRecordUnion } from '@vultisig/lib-utils/matchRecordUnion'
import { TW } from '@trustwallet/wallet-core'

import { getBlockchainSpecificValue } from '../../../chainSpecific/KeysignChainSpecific'
import { getKeysignSwapPayload } from '../../../swap/getKeysignSwapPayload'
import { getKeysignChain } from '../../../utils/getKeysignChain'
import { SigningInputsResolver } from '../../resolver'
import { getSolanaSendSigningInput } from './send'
import { maybeSplitOversizedSolanaSwap } from './splitOversizedTransaction'

export const getSolanaSigningInputs: SigningInputsResolver<'solana'> = ({
  keysignPayload,
  walletCore,
}) => {
  const chain = getKeysignChain(keysignPayload)

  const { recentBlockHash } = getBlockchainSpecificValue(
    keysignPayload.blockchainSpecific,
    'solanaSpecific'
  )

  if (keysignPayload.signData.case === 'signSolana') {
    const coinType = getCoinType({ walletCore, chain })
    const inputs = keysignPayload.signData.value.rawTransactions.map(
      transaction => {
        const decodedData = walletCore.TransactionDecoder.decode(
          coinType,
          Buffer.from(transaction, 'base64')
        )
        const decodedTransaction =
          TW.Solana.Proto.DecodingTransactionOutput.decode(decodedData)
        if (!decodedTransaction.transaction) {
          throw new Error("Can't decode transaction")
        }
        const rawMessage = decodedTransaction.transaction

        return TW.Solana.Proto.SigningInput.create({
          rawMessage,
        })
      }
    )
    return inputs
  }

  const swapPayload = getKeysignSwapPayload(keysignPayload)

  if (swapPayload) {
    return matchRecordUnion(swapPayload, {
      native: () => [getSolanaSendSigningInput({ keysignPayload, walletCore })],
      general: swapPayload => {
        const tx = shouldBePresent(swapPayload.quote?.tx)
        const { data } = tx

        const decodedData = walletCore.TransactionDecoder.decode(
          getCoinType({
            walletCore,
            chain,
          }),
          Buffer.from(data, 'base64')
        )
        const { transaction } =
          TW.Solana.Proto.DecodingTransactionOutput.decode(decodedData)

        if (!transaction) {
          throw new Error("Can't decode swap transaction")
        }

        // If the transaction exceeds Solana's 1232-byte limit, split into
        // two transactions with a JITO tip on the second. Both get signed
        // in the same MPC session and broadcast as an atomic JITO bundle.
        const signerAddress = keysignPayload.coin?.address ?? ''
        return maybeSplitOversizedSolanaSwap(
          transaction,
          recentBlockHash,
          data,
          signerAddress,
        )
      },
    })
  }

  return [getSolanaSendSigningInput({ keysignPayload, walletCore })]
}
