import { Chain, CosmosChain } from '@vultisig/core-chain/Chain'
import { cosmosFeeCoinDenom } from '@vultisig/core-chain/chains/cosmos/cosmosFeeCoinDenom'
import { getCosmosChainKind } from '@vultisig/core-chain/chains/cosmos/utils/getCosmosChainKind'
import {
  CosmosSpecific,
  MAYAChainSpecific,
  THORChainSpecific,
} from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'

import { chainSpecificRecord, getBlockchainSpecificValue } from '../../../chainSpecific/KeysignChainSpecific'

export type CosmosChainSpecific =
  | {
      ibcEnabled: CosmosSpecific
    }
  | { vaultBased: THORChainSpecific | MAYAChainSpecific }

export type CosmosFeeAmount = {
  amount: bigint
  denom: string
}

type GetCosmosFeeAmountsInput = {
  chain: CosmosChain
  coinId?: string
  chainSpecific: Pick<CosmosSpecific, 'gas' | 'ibcDenomTraces'>
  includeTerraClassicBurnTax: boolean
}

/**
 * Returns the fee coins that the Cosmos signing resolver puts in the SignDoc.
 *
 * TerraClassic USTC sends are the only path with a second fee coin: the
 * stability-tax surcharge pre-computed by the async chain-specific resolver.
 * Keeping that rule here gives fee display and signing one source of truth.
 */
export const getCosmosFeeAmounts = ({
  chain,
  coinId,
  chainSpecific,
  includeTerraClassicBurnTax,
}: GetCosmosFeeAmountsInput): CosmosFeeAmount[] => {
  const amounts: CosmosFeeAmount[] = [
    {
      amount: chainSpecific.gas,
      denom: cosmosFeeCoinDenom[chain],
    },
  ]

  if (includeTerraClassicBurnTax && chain === Chain.TerraClassic && coinId?.toLowerCase() === 'uusd') {
    const burnTaxAmount = BigInt(chainSpecific.ibcDenomTraces?.baseDenom || '0')
    if (burnTaxAmount > 0n) {
      amounts.push({
        amount: burnTaxAmount,
        denom: coinId,
      })
    }
  }

  return amounts
}

export const getCosmosChainSpecific = (
  chain: CosmosChain,
  blockchainSpecific: KeysignPayload['blockchainSpecific']
) => {
  const chainKind = getCosmosChainKind(chain)

  return {
    [chainKind]: getBlockchainSpecificValue(blockchainSpecific, chainSpecificRecord[chain]),
  } as CosmosChainSpecific
}
