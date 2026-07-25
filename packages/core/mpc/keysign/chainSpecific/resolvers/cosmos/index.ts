import { create } from '@bufbuild/protobuf'
import { Chain, IbcEnabledCosmosChain } from '@vultisig/core-chain/Chain'
import { getCosmosAccountInfo } from '@vultisig/core-chain/chains/cosmos/account/getCosmosAccountInfo'
import { getCosmosGasLimit } from '@vultisig/core-chain/chains/cosmos/cosmosGasLimitRecord'
import { getCosmosFeeAmount } from '@vultisig/core-chain/chains/cosmos/gas'
import { IBC_GAS_MULTIPLIER, scaleCosmosFeeAmount } from '@vultisig/core-chain/chains/cosmos/resolveCosmosGasLimit'
import {
  applyTerraClassicBurnTax,
  applyTerraClassicTax,
  getTerraClassicBurnTaxRate,
  getTerraClassicTaxCap,
  getTerraClassicTaxRate,
} from '@vultisig/core-chain/chains/cosmos/terraClassicTax'
import { isFeeCoin } from '@vultisig/core-chain/coin/utils/isFeeCoin'
import {
  CosmosSpecificSchema,
  TransactionType,
} from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'

import { getKeysignCoin } from '../../../utils/getKeysignCoin'
import { GetChainSpecificResolver } from '../../resolver'
import { estimateCosmosGasLimit } from './gasEstimation/estimateCosmosGasLimit'

/**
 * Computes the Terra Classic stability-tax surcharge for a USTC (uusd) send.
 *
 * The result is encoded in `ibcDenomTraces.baseDenom` so the signing-inputs
 * resolver can use the dynamic value instead of a hard-coded 1 USTC.
 * `baseDenom` is an empty string for all non-IBC sends — the only
 * interpretation for TerraClassic USTC sends is "pre-computed burn-tax
 * amount in base uusd units".
 *
 * Returns '0' when the on-chain rate is zero (current governance state).
 * Throws when the LCD is unreachable — caller catches and falls back to '0'.
 */
async function computeUstcBurnTaxAmount(toAmount: string): Promise<string> {
  const rate = await getTerraClassicTaxRate()
  if (rate === 0n) return '0'

  const cap = await getTerraClassicTaxCap('uusd')
  const tax = applyTerraClassicTax(BigInt(toAmount), 'uusd', rate, {
    uusd: cap,
  })
  return tax.toString()
}

export const getCosmosChainSpecific: GetChainSpecificResolver<'cosmosSpecific'> = async ({
  keysignPayload,
  walletCore,
  transactionType = TransactionType.UNSPECIFIED,
  timeoutTimestamp,
}) => {
  const coin = getKeysignCoin<IbcEnabledCosmosChain>(keysignPayload)
  const { accountNumber, sequenceBigInt, latestBlock } = await getCosmosAccountInfo(coin)

  // For TerraClassic USTC (uusd) sends, pre-compute the burn-tax surcharge
  // dynamically. Encoded in baseDenom so the sync signing-inputs resolver
  // can use it without an async LCD call. Falls back to '0' when the tax
  // rate is zero (current on-chain state post-UST-collapse governance).
  const isUstcSend = coin.chain === Chain.TerraClassic && coin.id?.toLowerCase() === 'uusd'
  let burnTaxBaseDenom = ''
  if (isUstcSend) {
    try {
      burnTaxBaseDenom = await computeUstcBurnTaxAmount(keysignPayload.toAmount)
    } catch {
      // Fail-open on burn-tax LCD outage: fall back to '0' to avoid blocking
      // the send. A $0.02 under-fee is better than a blocked tx when the
      // rate is currently zero. When the rate is non-zero and the LCD is
      // down, the tx will be rejected by the chain's ante handler.
      burnTaxBaseDenom = '0'
    }
  }

  // Initiator-side dynamic gas: simulate a native send via
  // `/cosmos/tx/v1beta1/simulate` and relay the padded gas limit to co-signers
  // in `CosmosSpecific.gas_limit`. Every co-signer signs the relayed limit when
  // it is present and > 0, otherwise every device falls back to the static
  // per-chain gas limit. Only native bank sends are simulated — the simulate tx
  // models a `MsgSend`, so token/IBC/contract/staking txs (non-UNSPECIFIED
  // transactionType, or a relayed dapp signData) keep the static limit. Fails
  // closed: any simulation error returns undefined and the field stays unset.
  // Optional chaining is deliberate: this gate runs at initiator build time on
  // payloads that can be shaped by external callers (dapp / inpage-provider),
  // and it sits outside the fail-closed estimator below — a payload missing the
  // `signData` oneof wrapper must be treated as "no relayed sign data" rather
  // than throw here.
  const hasRelayedSignData = keysignPayload.signData?.case !== undefined

  const isNativeSend =
    transactionType === TransactionType.UNSPECIFIED &&
    !hasRelayedSignData &&
    isFeeCoin(coin) &&
    !!keysignPayload.toAddress &&
    /^[0-9]+$/.test(keysignPayload.toAmount) &&
    BigInt(keysignPayload.toAmount) > 0n

  const simulatedGasLimit = isNativeSend
    ? await estimateCosmosGasLimit({
        walletCore,
        keysignPayload,
        accountNumber: BigInt(accountNumber),
        sequence: sequenceBigInt,
      })
    : undefined

  // COSMOS-02: an IBC `MsgTransfer` does more work on the source leg than the
  // flat per-chain limit (calibrated for `MsgSend`) budgets for, so widen it.
  // This has to be relayed in `gas_limit` rather than applied when signing:
  // there is no proto field for a multiplier, so a read-side one could not be
  // reproduced by iOS / Android and would diverge the SignDoc.
  const staticGasLimit = getCosmosGasLimit(coin)
  const ibcGasLimit = transactionType === TransactionType.IBC_TRANSFER ? staticGasLimit * IBC_GAS_MULTIPLIER : undefined

  const gasLimit = simulatedGasLimit ?? ibcGasLimit

  // `gas` is the fee AMOUNT every co-signer signs verbatim, so it must already
  // be priced for the limit we relay — chains that charge `gasLimit × price`
  // (Terra Classic, dYdX) would otherwise underpay the ante handler at a
  // widened limit. Scaling here, on the one device that builds the payload, is
  // what iOS (`CosmosGasPricedFee.scaled`) and Android
  // (`TerraClassicTax.baseGas`) do.
  //
  // Widening only. A simulated limit BELOW the static one is the common case
  // (a plain MsgSend burns well under the calibrated limit), and the static
  // amounts are acceptance floors — Osmosis's is fetched from its live txfees
  // module, Akash's is a fixed minimum — not per-gas rates that may be scaled
  // down. Shrinking them would risk "insufficient fee" for no benefit.
  const staticFeeAmount = await getCosmosFeeAmount(coin)
  const gasFeeAmount =
    gasLimit && gasLimit > staticGasLimit
      ? scaleCosmosFeeAmount({
          feeAmount: staticFeeAmount,
          fromGasLimit: staticGasLimit,
          toGasLimit: gasLimit,
        })
      : staticFeeAmount

  // Terra Classic charges a proportional burn tax (`x/tax`, currently 0.5%) on
  // a `MsgSend` in ADDITION to the gas fee. For native LUNC both are paid in
  // `uluna`, so they fold into the single `gas` amount — iOS and Android do the
  // same. Added AFTER the gas scaling above: the tax is proportional to the
  // transfer amount, not to the gas limit, so scaling it would be wrong.
  //
  // Until now this was absorbed implicitly by an oversized 20 LUNC flat fee,
  // which overcharged ordinary sends ~2× while still under-covering any send
  // above ~2,300 LUNC, where 0.5% outgrows the slack. Computing it explicitly
  // fixes both ends. Fails closed to the 0.5% governance rate on LCD error.
  //
  // USTC (`uusd`) is untouched here — its tax rides in `ibcDenomTraces.baseDenom`
  // as a separate fee coin (see `computeUstcBurnTaxAmount`).
  const isTerraClassicLuncSend = coin.chain === Chain.TerraClassic && isNativeSend
  const burnTax = isTerraClassicLuncSend
    ? applyTerraClassicBurnTax(BigInt(keysignPayload.toAmount), await getTerraClassicBurnTaxRate())
    : 0n

  const gas = gasFeeAmount + burnTax

  return create(CosmosSpecificSchema, {
    accountNumber: BigInt(accountNumber),
    sequence: sequenceBigInt,
    transactionType,
    gas,
    gasLimit,
    ibcDenomTraces: {
      latestBlock: timeoutTimestamp ? `${latestBlock.split('_')[0]}_${timeoutTimestamp}` : latestBlock,
      baseDenom: burnTaxBaseDenom,
      path: '',
    },
  })
}
