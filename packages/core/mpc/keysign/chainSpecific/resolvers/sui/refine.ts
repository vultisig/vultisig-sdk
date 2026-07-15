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

export const refineSuiChainSpecific = async ({
  keysignPayload,
  chainSpecific,
  rawCoins,
  walletCore,
}: RefineSuiChainSpecificInput): Promise<SuiSpecific> => {
  const client = getSuiClient()

  // `chainSpecific.coins` here is the baseline selection (sdk#1132), sized
  // against the static `suiGasBudget` default — good enough to build a valid
  // dry-run tx, but not yet the real cost.
  const [txInputData] = await getEncodedSigningInputs({
    keysignPayload: create(KeysignPayloadSchema, {
      ...keysignPayload,
      blockchainSpecific: {
        case: 'suicheSpecific',
        value: chainSpecific,
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

  const gasBudget = maxBigInt(gasBudgetMultiplier(BigInt(computationCost) + BigInt(storageCost)), suiMinGasBudget)

  // Re-select the payload coins from the FULL owned set against the REAL
  // (refined) budget (sdk#1216 follow-up). Locking the baseline-sized
  // selection in as the final payload left native sends with near-zero
  // selection slack under-covered once the actual dry-run cost exceeded the
  // static estimate — the payload was already narrowed at that point, so the
  // wallet's remaining objects were unreachable at final signing time even
  // though the wallet held plenty of balance in aggregate. The payload coins
  // now lock exactly once, AFTER the real budget is known.
  const coin = getKeysignCoin(keysignPayload)
  const coins = selectSuiPayloadCoins({
    coins: rawCoins,
    contractAddress: coin.id ?? '',
    amount: BigInt(keysignPayload.toAmount || '0'),
    gasBudget,
  })

  return {
    ...chainSpecific,
    coins,
    gasBudget: gasBudget.toString(),
  }
}
