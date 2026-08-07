import { create } from '@bufbuild/protobuf'
import { getSuiClient } from '@vultisig/core-chain/chains/sui/client'
import { suiGasBudget } from '@vultisig/core-chain/chains/sui/config'
import { listAllSuiCoins } from '@vultisig/core-chain/chains/sui/listAllCoins'
import { getSuiPrebuiltGasData } from '@vultisig/core-chain/chains/sui/prebuiltGasData'
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
  // Pre-built PTBs (`signData.signSui` — dApp Wallet Standard requests and
  // SwapKit Sui-source swaps) are already fully built: coins, gas budget and
  // reference gas price are baked into the BCS bytes that `getSuiSigningInputs`
  // forwards verbatim. There are no construction inputs to fetch, so skip the
  // RPC entirely and read the gas numbers back out of the bytes — without them
  // `getSuiFeeAmount` reports a 0 network fee on the confirmation screen.
  if (keysignPayload.signData.case === 'signSui') {
    return create(SuiSpecificSchema, getSuiPrebuiltGasData(keysignPayload.signData.value.unsignedTxMsg))
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
  // A payload can name SUI as its "token" id; listing it twice would duplicate every
  // native object in the selection pool, so only a genuinely distinct type is fetched.
  const tokenCoinType = coin.id && !isSameSuiCoinType(coin.id, suiNativeCoinType) ? coin.id : undefined

  const [nativeCoins, tokenCoins] = await Promise.all([
    listAllSuiCoins({ client, owner: address, coinType: suiNativeCoinType }),
    tokenCoinType ? listAllSuiCoins({ client, owner: address, coinType: tokenCoinType }) : Promise.resolve([]),
  ])

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
