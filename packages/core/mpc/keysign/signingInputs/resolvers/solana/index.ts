import { Buffer } from 'buffer'
import { getCoinType } from '@vultisig/core-chain/coin/coinType'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'
import { matchRecordUnion } from '@vultisig/lib-utils/matchRecordUnion'
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
    // Handled upstream in getEncodedSigningInputs (sdk#1204): dApp raw
    // transactions are signed over their ORIGINAL message bytes and never
    // routed through TransactionDecoder + SigningInput.rawMessage — the
    // WalletCore re-encode is not byte-identical for v0+ALT transactions
    // and breaks mixed-vault co-signing (ios#4419, android#5223). Reaching
    // this branch means a caller bypassed getEncodedSigningInputs; fail
    // loud instead of silently re-introducing the divergent pre-image.
    throw new Error(
      'signSolana raw transactions are handled in getEncodedSigningInputs — do not resolve them into TW SigningInputs (sdk#1204)'
    )
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
