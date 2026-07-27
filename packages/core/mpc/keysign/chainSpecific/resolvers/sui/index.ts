import { create } from '@bufbuild/protobuf'
import { getSuiClient } from '@vultisig/core-chain/chains/sui/client'
import { suiGasBudget } from '@vultisig/core-chain/chains/sui/config'
import { listAllSuiCoins } from '@vultisig/core-chain/chains/sui/listAllCoins'
import { SuiCoinSchema, SuiSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { attempt } from '@vultisig/lib-utils/attempt'

import { getKeysignCoin } from '../../../utils/getKeysignCoin'
import { isSameSuiCoinType, selectSuiPayloadCoins, suiNativeCoinType } from '../../../suiCoinSelection'
import { GetChainSpecificResolver } from '../../resolver'
import { refineSuiChainSpecific } from './refine'

class SuiGasBudgetConvergenceError extends Error {}

export const getSuiChainSpecific: GetChainSpecificResolver<'suicheSpecific'> = async ({
  keysignPayload,
  walletCore,
}) => {
  // dApp-supplied PTBs (`signData.signSui`) are already fully built: coins,
  // gas budget and reference gas price are baked into the BCS bytes that
  // `getSuiSigningInputs` forwards verbatim. There are no construction inputs
  // to fetch, so return an empty SuiSpecific instead of hitting the RPC.
  if (keysignPayload.signData.case === 'signSui') {
    return create(SuiSpecificSchema, {})
  }

  const coin = getKeysignCoin(keysignPayload)
  const { address } = coin
  const client = getSuiClient()

  // The retired JSON-RPC `getAllCoins` returned every coin type in one paginated
  // sweep. The unified client's `listCoins` is scoped to ONE coin type (SUI by
  // default), so fetch exactly the two sets the payload needs and nothing more:
  //   - native SUI objects, always — they pay gas for both Pay and PaySui;
  //   - the sent coin type's objects, when sending a non-native token.
  // `listAllSuiCoins` follows the cursor to completion (see its comment on why
  // a single page silently under-funds a send) and is bounded so a stuck cursor
  // fails closed instead of spinning.
  const isNativeToken = !coin.id
  const sendsNonNativeToken = !!coin.id && !isSameSuiCoinType(coin.id, suiNativeCoinType)

  const nativeCoins = await listAllSuiCoins({ client, owner: address, coinType: suiNativeCoinType })
  const tokenCoins = sendsNonNativeToken
    ? await listAllSuiCoins({ client, owner: address, coinType: coin.id as string })
    : []

  const coins = [...nativeCoins, ...tokenCoins].map(rawCoin => create(SuiCoinSchema, rawCoin))

  const { referenceGasPrice } = await client.getReferenceGasPrice()
  const amount = BigInt(keysignPayload.toAmount || '0')
  const selectCoins = (gasBudget: bigint) =>
    selectSuiPayloadCoins({
      coins,
      isNativeToken,
      coinType: coin.id,
      amount,
      gasBudget,
    })

  const chainSpecific = create(SuiSpecificSchema, {
    coins: selectCoins(suiGasBudget),
    referenceGasPrice: referenceGasPrice.toString(),
    gasBudget: suiGasBudget.toString(),
  })

  // PaySui gas cost grows with the number of input objects. Refining the
  // baseline budget can therefore select more objects than the dry run priced.
  // Re-price that grown selection, bounded so a pathological RPC response
  // cannot make transaction construction loop indefinitely.
  const maxGasBudgetConvergeIterations = 2
  const initialRefinement = await attempt(() =>
    refineSuiChainSpecific({
      keysignPayload,
      chainSpecific,
      walletCore,
    })
  )

  // Preserve the historical fallback only when the first dry run cannot
  // refine the static baseline. Once refinement has learned a higher gas
  // requirement, returning that baseline on a later re-price or re-selection
  // failure would knowingly construct an under-budget transaction.
  if ('error' in initialRefinement) return chainSpecific

  let priced = initialRefinement.data
  let gasBudget = priced.gasBudget ? BigInt(priced.gasBudget) : suiGasBudget
  let selectedCoins = selectCoins(gasBudget)
  let pricedCoinCount = chainSpecific.coins.length

  for (
    let iteration = 0;
    iteration < maxGasBudgetConvergeIterations && selectedCoins.length > pricedCoinCount;
    iteration++
  ) {
    const repriced = await refineSuiChainSpecific({
      keysignPayload,
      chainSpecific: create(SuiSpecificSchema, {
        ...priced,
        coins: selectedCoins,
        gasBudget: gasBudget.toString(),
      }),
      walletCore,
    })
    const repricedGasBudget = repriced.gasBudget ? BigInt(repriced.gasBudget) : gasBudget
    const nextGasBudget = repricedGasBudget > gasBudget ? repricedGasBudget : gasBudget
    pricedCoinCount = selectedCoins.length
    if (nextGasBudget === gasBudget) break

    gasBudget = nextGasBudget
    priced = repriced
    selectedCoins = selectCoins(gasBudget)
  }

  if (selectedCoins.length > pricedCoinCount) {
    throw new SuiGasBudgetConvergenceError(
      `Sui gas budget did not converge after ${maxGasBudgetConvergeIterations} re-price rounds`
    )
  }

  return create(SuiSpecificSchema, {
    ...priced,
    coins: selectedCoins,
    gasBudget: gasBudget.toString(),
  })
}
