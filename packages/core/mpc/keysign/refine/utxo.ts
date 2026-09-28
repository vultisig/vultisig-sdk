import { create } from '@bufbuild/protobuf'
import { getUtxoMinSendAmountError } from '@vultisig/core-chain/chains/utxo/send/validateUtxoRequirements'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'
import { bigIntSum } from '@vultisig/lib-utils/bigint/bigIntSum'
import { WalletCore } from '@trustwallet/wallet-core'
import { TW } from '@trustwallet/wallet-core'
import { PublicKey } from '@trustwallet/wallet-core/dist/src/wallet-core'

import { UTXOSpecificSchema } from '../../types/vultisig/keysign/v1/blockchain_specific_pb'
import { KeysignPayload } from '../../types/vultisig/keysign/v1/keysign_message_pb'
import { UtxoInfoSchema } from '../../types/vultisig/keysign/v1/utxo_info_pb'
import { getBlockchainSpecificValue } from '../chainSpecific/KeysignChainSpecific'
import { BuildKeysignPayloadError } from '../error'
import { getUtxoSigningInputs } from '../signingInputs/resolvers/utxo'
import { getKeysignAmount } from '../utils/getKeysignAmount'
import { getKeysignChain } from '../utils/getKeysignChain'

type RefineKeysignUtxoInput = {
  keysignPayload: KeysignPayload
  walletCore: WalletCore
  publicKey: PublicKey
}

const dustStats = 600n

type ConvertPlanUtxosToUtxoInfoInput = {
  utxos: Array<TW.Bitcoin.Proto.IUnspentTransaction>
  walletCore: WalletCore
}

const convertPlanUtxosToUtxoInfo = ({ utxos, walletCore }: ConvertPlanUtxosToUtxoInfoInput) =>
  utxos.map(({ outPoint, amount }) => {
    const hash = shouldBePresent(outPoint?.hash, 'UTXO outPoint hash')
    const index = shouldBePresent(outPoint?.index, 'UTXO outPoint index')

    return create(UtxoInfoSchema, {
      hash: walletCore.HexCoding.encode(Uint8Array.from(hash).reverse()),
      amount: BigInt(shouldBePresent(amount, 'UTXO amount').toString()),
      index,
    })
  })

export const refineKeysignUtxo = async (input: RefineKeysignUtxoInput): Promise<KeysignPayload> => {
  const utxoSpecific = getBlockchainSpecificValue(input.keysignPayload.blockchainSpecific, 'utxoSpecific')

  // PSBTs already have UTXOs defined — skip refinement.
  // When signData is signBitcoin, the PSBT defines exact inputs/outputs.
  if (input.keysignPayload.signData.case === 'signBitcoin') {
    return input.keysignPayload
  }

  const [signingInput] = await getUtxoSigningInputs(input)

  const plan = shouldBePresent(signingInput.plan, 'UTXO signing input plan')
  const planUtxos = plan.utxos

  const amount = getKeysignAmount(input.keysignPayload)

  if (!planUtxos || planUtxos.length === 0) {
    const planError = plan.error
    const errorName =
      planError == null
        ? `Unknown(${String(planError)})`
        : (TW.Common.Proto.SigningError[planError] ?? `Unknown(${planError})`)

    if (planError === TW.Common.Proto.SigningError.Error_dust_amount_requested) {
      const minSendAmountError = amount
        ? getUtxoMinSendAmountError({
            amount,
            chain: getKeysignChain<'utxo'>(input.keysignPayload),
          })
        : undefined

      throw new BuildKeysignPayloadError(
        'utxo-dust-amount-requested',
        minSendAmountError ?? `Failed to build transaction: ${errorName}`
      )
    }

    if (
      planError === TW.Common.Proto.SigningError.Error_low_balance ||
      planError === TW.Common.Proto.SigningError.Error_missing_input_utxos ||
      planError === TW.Common.Proto.SigningError.Error_not_enough_utxos
    ) {
      throw new BuildKeysignPayloadError(
        'not-enough-funds',
        `Failed to build transaction: insufficient balance (${errorName})`
      )
    }

    // WalletCore reports failed plans through `plan.error`. An empty plan is
    // therefore never evidence that retrying the caller's amount as max is
    // safe; only the successful-plan dust-change check below may select max.
    throw new Error(`Failed to build transaction: ${errorName}`)
  }

  const actualFee = BigInt(shouldBePresent(plan.fee, 'UTXO signing input plan fee').toString())

  if (amount && !utxoSpecific.sendMaxAmount) {
    const balance = bigIntSum(input.keysignPayload.utxoInfo.map(({ amount }) => amount))
    const remainingBalance = balance - amount

    if (remainingBalance <= actualFee + dustStats) {
      return refineKeysignUtxo({
        ...input,
        keysignPayload: {
          ...input.keysignPayload,
          blockchainSpecific: {
            case: 'utxoSpecific',
            value: create(UTXOSpecificSchema, {
              ...utxoSpecific,
              sendMaxAmount: true,
            }),
          },
        },
      })
    }
  }

  return {
    ...input.keysignPayload,
    utxoInfo: convertPlanUtxosToUtxoInfo({
      utxos: planUtxos,
      walletCore: input.walletCore,
    }),
  }
}
