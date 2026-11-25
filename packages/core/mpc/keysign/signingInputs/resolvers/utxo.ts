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

/** Max byteFee re-plans before we give up raising the Zcash fee. */
const maxZcashFeeBumps = 5

type PlanZcashConventionalFeeInput = {
  input: TW.Bitcoin.Proto.SigningInput
  memo: string | undefined
  planInput: (signingInput: TW.Bitcoin.Proto.SigningInput) => TW.Bitcoin.Proto.TransactionPlan
}

/**
 * Produce a Zcash plan whose fee meets the ZIP-317 conventional fee at
 * {@link zcashMarginalFee} (1,000 zats per action under ZIP 2009).
 *
 * WalletCore's `zip_0317` planner can't do that: it hardcodes 5,000 zats per
 * action, ignores `byteFee`, and sizes an OP_RETURN output as a flat ~34 bytes.
 * So every Zcash plan is built with `zip_0317` off — where WalletCore honours
 * `byteFee` — starting at 1 zat/byte and raising `byteFee` until the fee clears
 * the byte-accurate conventional fee. The result is the conventional fee
 * rounded up to whole zats per byte.
 *
 * Co-signers derive the signed transaction from this plan, so every platform
 * must run this exact sequence (start at 1, then the bump formula below) and
 * the same {@link zcashMarginalFee}, or keysign digests diverge.
 *
 * An empty plan (no selected UTXOs) is returned untouched so refinement can
 * report the planner failure. Only the caller decides whether a request is MAX.
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

  input.zip_0317 = false
  let byteFee = 1n
  for (let attempt = 1; ; attempt++) {
    input.byteFee = Long.fromString(byteFee.toString())
    const plan = planInput(input)
    if (meetsConventionalFee(plan)) {
      return plan
    }

    if (attempt === maxZcashFeeBumps) {
      throw new Error(
        `Failed to meet the Zcash minimum network fee (ZIP-317): planned ${plan.fee.toString()} zats, required ${conventionalFee(plan)}`
      )
    }

    // byteFee mode scales fee linearly with vsize; derive the byteFee that
    // clears the conventional fee for this plan's (byteFee-independent) vsize.
    const fee = BigInt(plan.fee.toString())
    const plannerVsize = fee > 0n ? fee / byteFee : 1n
    byteFee = bigIntMax(ceilDiv({ value: conventionalFee(plan), divisor: plannerVsize }), byteFee + 1n)
  }
}
