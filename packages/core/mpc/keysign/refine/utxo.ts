import { create } from '@bufbuild/protobuf'
import { fromChainAmount } from '@vultisig/core-chain/amount/fromChainAmount'
import { getUtxoMinSendAmountError } from '@vultisig/core-chain/chains/utxo/send/validateUtxoRequirements'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'
import { bigIntSum } from '@vultisig/lib-utils/bigint/bigIntSum'
import { formatAmount } from '@vultisig/lib-utils/formatAmount'
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
  // WalletCore's proto3 enum defaults to OK even though the generated
  // TypeScript interface still permits nullish values.
  const planError = plan.error as TW.Common.Proto.SigningError
  const errorName = TW.Common.Proto.SigningError[planError] ?? `Unknown(${planError})`

  if (planError !== TW.Common.Proto.SigningError.OK) {
    if (planError === TW.Common.Proto.SigningError.Error_dust_amount_requested) {
      const chain = getKeysignChain<'utxo'>(input.keysignPayload)
      const minSendAmountError = amount
        ? getUtxoMinSendAmountError({
            amount,
            chain,
          })
        : undefined
      const { decimals, ticker } = chainFeeCoin[chain]
      const formattedAmount = formatAmount(fromChainAmount(amount, decimals), {
        ticker,
      })

      throw new BuildKeysignPayloadError(
        'utxo-dust-amount-requested',
        minSendAmountError ??
          `Amount ${formattedAmount} is below the network dust threshold at the current fee rate; increase the amount and try again.`
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

    throw new Error(`Failed to build transaction: ${errorName}`)
  }

  if (!planUtxos || planUtxos.length === 0) {
    // A successful planner result still needs inputs. An empty plan is never
    // evidence that retrying the caller's amount as max is safe; only the
    // successful-plan dust-change check below may select max.
    throw new Error('Failed to build transaction: planner returned no inputs')
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
