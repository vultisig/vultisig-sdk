import { create } from '@bufbuild/protobuf'
import { Chain, IbcEnabledCosmosChain } from '@vultisig/core-chain/Chain'
import { getCosmosAccountInfo } from '@vultisig/core-chain/chains/cosmos/account/getCosmosAccountInfo'
import { cosmosGasRecord } from '@vultisig/core-chain/chains/cosmos/gas'
import {
  applyTerraClassicTax,
  getTerraClassicTaxCap,
  getTerraClassicTaxRate,
} from '@vultisig/core-chain/chains/cosmos/terraClassicTax'
import {
  CosmosSpecificSchema,
  TransactionType,
} from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'

import { getKeysignCoin } from '../../utils/getKeysignCoin'
import { GetChainSpecificResolver } from '../resolver'

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
  const tax = applyTerraClassicTax(BigInt(toAmount), 'uusd', rate, { uusd: cap })
  return tax.toString()
}

export const getCosmosChainSpecific: GetChainSpecificResolver<
  'cosmosSpecific'
> = async ({
  keysignPayload,
  transactionType = TransactionType.UNSPECIFIED,
  timeoutTimestamp,
}) => {
  const coin = getKeysignCoin<IbcEnabledCosmosChain>(keysignPayload)
  const { accountNumber, sequence, latestBlock } =
    await getCosmosAccountInfo(coin)

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

  return create(CosmosSpecificSchema, {
    accountNumber: BigInt(accountNumber),
    sequence: BigInt(sequence),
    transactionType,
    gas: cosmosGasRecord[coin.chain],
    ibcDenomTraces: {
      latestBlock: timeoutTimestamp
        ? `${latestBlock.split('_')[0]}_${timeoutTimestamp}`
        : latestBlock,
      baseDenom: burnTaxBaseDenom,
      path: '',
    },
  })
}
