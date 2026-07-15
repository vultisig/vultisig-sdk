import { Buffer } from 'buffer'
import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { getSuiClient } from '@vultisig/core-chain/chains/sui/client'
import { suiMinGasBudget } from '@vultisig/core-chain/chains/sui/config'
import { SuiCoin, SuiSpecific } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { KeysignPayload, KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { maxBigInt } from '@vultisig/lib-utils/math/maxBigInt'
import { WalletCore } from '@trustwallet/wallet-core'

import { selectSuiPayloadCoins } from '../../../../chains/sui/coinSelection'
import { getKeysignCoin } from '../../../utils/getKeysignCoin'
import { getPreSigningOutput } from '../../../preSigningOutput'
import { getEncodedSigningInputs } from '../../../signingInputs'

const gasBudgetMultiplier = (value: bigint) => (value * 115n) / 100n

type RefineSuiChainSpecificInput = {
  keysignPayload: KeysignPayload
  chainSpecific: SuiSpecific
  /** The full owned-coin set (unbounded), for the post-refine re-selection below. */
  rawCoins: SuiCoin[]
  walletCore: WalletCore
}

/**
 * Dry-runs `priced` (its `coins`/`gasBudget` baked into a real PaySui/Pay tx)
 * and returns the real, multiplied-up gas budget the dry run reports.
 */
const priceGasBudget = async ({
  keysignPayload,
  priced,
  walletCore,
}: {
  keysignPayload: KeysignPayload
  priced: SuiSpecific
  walletCore: WalletCore
}): Promise<bigint> => {
  const client = getSuiClient()

  const [txInputData] = await getEncodedSigningInputs({
    keysignPayload: create(KeysignPayloadSchema, {
      ...keysignPayload,
      blockchainSpecific: {
        case: 'suicheSpecific',
        value: priced,
      },
    }),
    walletCore,
  })

  const { data } = getPreSigningOutput({
    walletCore,
    txInputData,
    chain: Chain.Sui,
  })

  const txBytes = Buffer.from(data).subarray(3).toString('base64')

  const {
    effects: {
      gasUsed: { computationCost, storageCost },
    },
  } = await client.dryRunTransactionBlock({
    transactionBlock: txBytes,
  })

  return maxBigInt(gasBudgetMultiplier(BigInt(computationCost) + BigInt(storageCost)), suiMinGasBudget)
}

// Bounds the re-pricing convergence loop below (a fail-safe, not the
// expected path — see the comment at the loop). Two rounds is generous: each
// round only adds objects to cover the PREVIOUS round's budget increase, and
// that increase itself shrinks round over round (a larger selection is
// closer to exhausting the wallet's largest objects, so there's proportionally
// less balance left for the next round to add), so this converges in
// practice within one round.
const maxGasBudgetConvergeIterations = 2

export const refineSuiChainSpecific = async ({
  keysignPayload,
  chainSpecific,
  rawCoins,
  walletCore,
}: RefineSuiChainSpecificInput): Promise<SuiSpecific> => {
  const coin = getKeysignCoin(keysignPayload)
  const contractAddress = coin.id ?? ''
  const amount = BigInt(keysignPayload.toAmount || '0')

  // `chainSpecific.coins` here is the baseline selection (sdk#1132), sized
  // against the static `suiGasBudget` default — good enough to build a valid
  // dry-run tx, but not yet the real cost.
  let gasBudget = await priceGasBudget({ keysignPayload, priced: chainSpecific, walletCore })

  // Re-select the payload coins from the FULL owned set against the REAL
  // (refined) budget (sdk#1216 follow-up). Locking the baseline-sized
  // selection in as the final payload left native sends with near-zero
  // selection slack under-covered once the actual dry-run cost exceeded the
  // static estimate — the payload was already narrowed at that point, so the
  // wallet's remaining objects were unreachable at final signing time even
  // though the wallet held plenty of balance in aggregate. The payload coins
  // now lock exactly once, AFTER the real budget is known.
  let coins = selectSuiPayloadCoins({ coins: rawCoins, contractAddress, amount, gasBudget })

  // PaySui gas-smashes its entire input set, so a native send's real cost
  // scales with object count. If the re-selection above needed MORE objects
  // than the baseline dry run above priced, that dry run under-priced the
  // ACTUAL (bigger) tx — a stale-budget InsufficientGas failure in the
  // dusty-wallet corner, never a fund-safety issue, but worth pricing
  // correctly rather than leaving a known-stale estimate. Re-price against
  // the grown selection and re-select once more; see the iteration bound above.
  let priorCoinCount = chainSpecific.coins.length
  for (let iteration = 0; iteration < maxGasBudgetConvergeIterations && coins.length > priorCoinCount; iteration++) {
    const reprice = await priceGasBudget({
      keysignPayload,
      priced: { ...chainSpecific, coins, gasBudget: gasBudget.toString() },
      walletCore,
    })
    const nextGasBudget = maxBigInt(reprice, gasBudget)
    if (nextGasBudget === gasBudget) break // re-pricing didn't increase further — converged

    priorCoinCount = coins.length
    gasBudget = nextGasBudget
    coins = selectSuiPayloadCoins({ coins: rawCoins, contractAddress, amount, gasBudget })
  }

  return {
    ...chainSpecific,
    coins,
    gasBudget: gasBudget.toString(),
  }
}
