import { Buffer } from 'buffer'
import { UtxoChain } from '@vultisig/core-chain/Chain'
import {
  ceilDiv,
  getZcashConventionalFee,
  getZcashTransparentOutputSizes,
} from '@vultisig/core-chain/chains/utxo/fee/zip317'
import { minUtxo } from '@vultisig/core-chain/chains/utxo/minUtxo'
import { utxoChainScriptType } from '@vultisig/core-chain/chains/utxo/tx/UtxoScriptType'
import { getZcashBranchIdHex } from '@vultisig/core-chain/chains/utxo/zcashBranchId'
import { getCoinType } from '@vultisig/core-chain/coin/coinType'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'
import { bigIntMax } from '@vultisig/lib-utils/bigint/bigIntMax'
import { match } from '@vultisig/lib-utils/match'
import { matchRecordUnion } from '@vultisig/lib-utils/matchRecordUnion'
import { getRecordUnionValue } from '@vultisig/lib-utils/record/union/getRecordUnionValue'
import { TW } from '@trustwallet/wallet-core'
import Long from 'long'

import { getBlockchainSpecificValue } from '../../chainSpecific/KeysignChainSpecific'
import { getKeysignSwapPayload } from '../../swap/getKeysignSwapPayload'
import { KeysignSwapPayload } from '../../swap/KeysignSwapPayload'
import { getKeysignChain } from '../../utils/getKeysignChain'
import { SigningInputsResolver } from '../resolver'

export const getUtxoSigningInputs: SigningInputsResolver<'utxo'> = async ({ keysignPayload, walletCore }) => {
  const chain = getKeysignChain<'utxo'>(keysignPayload)
  const zcashBranchIdHex = chain === UtxoChain.Zcash ? await getZcashBranchIdHex() : undefined

  const { byteFee, sendMaxAmount } = getBlockchainSpecificValue(keysignPayload.blockchainSpecific, 'utxoSpecific')

  const coin = shouldBePresent(keysignPayload.coin)

  const coinType = getCoinType({
    walletCore,
    chain,
  })

  const lockScript = walletCore.BitcoinScript.lockScriptForAddress(coin.address, coinType)

  const scriptType = utxoChainScriptType[chain]

  const pubKeyHash = match(scriptType, {
    wpkh: () => lockScript.matchPayToWitnessPublicKeyHash(),
    pkh: () => lockScript.matchPayToPubkeyHash(),
  })

  const scriptKey = Buffer.from(pubKeyHash).toString('hex')

  const script = match(scriptType, {
    wpkh: () => walletCore.BitcoinScript.buildPayToWitnessPubkeyHash(pubKeyHash).data(),
    pkh: () => walletCore.BitcoinScript.buildPayToPublicKeyHash(pubKeyHash).data(),
  })

  const swapPayload = getKeysignSwapPayload(keysignPayload)
  const amount = swapPayload ? getRecordUnionValue(swapPayload).fromAmount : keysignPayload.toAmount

  const destinationAddress = swapPayload
    ? matchRecordUnion<KeysignSwapPayload, string>(swapPayload, {
        native: swapPayload => swapPayload.vaultAddress,
        // Deposit-channel SwapKit routes: toAddress is the provider deposit-channel address.
        // See JSDoc on buildSwapKeysignPayload for the invariant that guarantees it is set.
        general: () => {
          const toAddress = keysignPayload.toAddress
          if (!toAddress) {
            throw new Error('UTXO general swap: destination address is missing from keysign payload')
          }
          if (!walletCore.AnyAddress.isValid(toAddress, coinType)) {
            throw new Error(`UTXO general swap: destination address "${toAddress}" is not valid for this chain`)
          }
          return toAddress
        },
      })
    : keysignPayload.toAddress

  const input = TW.Bitcoin.Proto.SigningInput.create({
    hashType: walletCore.BitcoinScript.hashTypeForCoin(coinType),
    amount: Long.fromString(amount),
    useMaxAmount: sendMaxAmount,
    toAddress: destinationAddress,
    changeAddress: coin.address,
    byteFee: Long.fromString(byteFee),
    zip_0317: chain === UtxoChain.Zcash,
    coinType: coinType.value,
    fixedDustThreshold: Long.fromBigInt(minUtxo[chain]),
    scripts: {
      [scriptKey]: script,
    },
    utxo: keysignPayload.utxoInfo.map(({ hash, amount, index }) =>
      TW.Bitcoin.Proto.UnspentTransaction.create({
        amount: Long.fromString(amount.toString()),
        outPoint: TW.Bitcoin.Proto.OutPoint.create({
          hash: walletCore.HexCoding.decode(hash).reverse(),
          index: index,
          sequence: 0xffffffff,
        }),
        script: lockScript.data(),
      })
    ),
  })

  if (keysignPayload.memo) {
    const encoder = new TextEncoder()
    input.outputOpReturn = encoder.encode(keysignPayload.memo)
  }

  const planInput = (signingInput: TW.Bitcoin.Proto.SigningInput) =>
    TW.Bitcoin.Proto.TransactionPlan.decode(
      walletCore.AnySigner.plan(TW.Bitcoin.Proto.SigningInput.encode(signingInput).finish(), coinType)
    )

  input.plan =
    chain === UtxoChain.Zcash
      ? planZcashConventionalFee({
          input,
          memo: keysignPayload.memo,
          planInput,
        })
      : planInput(input)

  if (chain === UtxoChain.Zcash) {
    input.plan.branchId = Buffer.from(shouldBePresent(zcashBranchIdHex, 'Zcash branch id'), 'hex')
  }

  return [input]
}

/** Max non-ZIP-317 re-plans before we give up raising the Zcash fee. */
const maxZcashFeeBumps = 5

type PlanZcashConventionalFeeInput = {
  input: TW.Bitcoin.Proto.SigningInput
  memo: string | undefined
  planInput: (signingInput: TW.Bitcoin.Proto.SigningInput) => TW.Bitcoin.Proto.TransactionPlan
}

/**
 * Produce a Zcash plan whose fee meets the ZIP-317 conventional fee.
 *
 * WalletCore's `zip_0317` planner sizes an OP_RETURN output as a flat ~34
 * bytes and ignores `byteFee`, so memo sends plan exactly one logical action
 * short (e.g. 15,000 zats where the network requires 20,000) with no way to
 * raise the fee in that mode. When the `zip_0317` plan underpays the
 * byte-accurate conventional fee, we re-plan with `zip_0317` off — where
 * WalletCore honours `byteFee` — and bump `byteFee` until the fee clears.
 * Plain (no-memo) sends already meet the fee and keep the `zip_0317` plan.
 *
 * An empty plan (no selected UTXOs) is returned untouched: it means the
 * coin selection produced nothing yet (insufficient funds, or before
 * `refineKeysignUtxo` flips `sendMaxAmount`), and that flow owns the outcome.
 */
const planZcashConventionalFee = ({
  input,
  memo,
  planInput,
}: PlanZcashConventionalFeeInput): TW.Bitcoin.Proto.TransactionPlan => {
  const conventionalFee = (plan: TW.Bitcoin.Proto.TransactionPlan): bigint =>
    getZcashConventionalFee({
      inputCount: plan.utxos.length,
      outputSizes: getZcashTransparentOutputSizes({
        change: BigInt(plan.change.toString()),
        memo,
      }),
    })

  // An empty plan has no shape to charge for; leave the fee flow to the caller.
  const meetsConventionalFee = (plan: TW.Bitcoin.Proto.TransactionPlan): boolean =>
    plan.utxos.length === 0 || BigInt(plan.fee.toString()) >= conventionalFee(plan)

  const zipPlan = planInput(input)
  if (meetsConventionalFee(zipPlan)) {
    return zipPlan
  }

  input.zip_0317 = false
  let byteFee = 1n
  let plan = zipPlan
  for (let bump = 0; bump < maxZcashFeeBumps; bump++) {
    input.byteFee = Long.fromString(byteFee.toString())
    plan = planInput(input)
    if (meetsConventionalFee(plan)) {
      return plan
    }

    // byteFee mode scales fee linearly with vsize; derive the byteFee that
    // clears the conventional fee for this plan's (byteFee-independent) vsize.
    const fee = BigInt(plan.fee.toString())
    const plannerVsize = fee > 0n ? fee / byteFee : 1n
    byteFee = bigIntMax(ceilDiv({ value: conventionalFee(plan), divisor: plannerVsize }), byteFee + 1n)
  }

  throw new Error(
    `Failed to meet the Zcash minimum network fee (ZIP-317): planned ${plan.fee.toString()} zats, required ${conventionalFee(plan)}`
  )
}
