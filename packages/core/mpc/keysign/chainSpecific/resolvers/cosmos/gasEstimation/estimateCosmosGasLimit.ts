import { CosmosChain } from '@vultisig/core-chain/Chain'
import { cosmosFeeCoinDenom } from '@vultisig/core-chain/chains/cosmos/cosmosFeeCoinDenom'
import { WalletCore } from '@trustwallet/wallet-core'
import { attempt } from '@vultisig/lib-utils/attempt'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'

import { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'

import { getKeysignCoin } from '../../../../utils/getKeysignCoin'
import { buildSimulateTxBytes } from './buildSimulateTxBytes'
import { scaleCosmosGasLimit } from './scaleCosmosGasLimit'
import { simulateCosmosGas } from './simulateCosmosGas'

type EstimateCosmosGasLimitInput = {
  walletCore: WalletCore
  keysignPayload: KeysignPayload
  accountNumber: bigint
  sequence: bigint
}

/**
 * Initiator-side dynamic gas estimation for a native Cosmos bank send.
 *
 * Simulates the send via `/cosmos/tx/v1beta1/simulate` and returns the padded
 * (`× 1.3`) gas limit the initiator relays to co-signers in
 * `CosmosSpecific.gas_limit`. Returns `undefined` on ANY failure — network
 * error, malformed tx, or zero `gas_used` — so the caller falls back to the
 * static per-chain gas limit and simulation never blocks signing.
 *
 * Mirrors iOS `CosmosGasEstimator.estimateGasLimit`. The caller
 * (`getCosmosChainSpecific`) is responsible for restricting this to native
 * sends; a `MsgSend` is the only shape modeled here.
 */
export const estimateCosmosGasLimit = async ({
  walletCore,
  keysignPayload,
  accountNumber,
  sequence,
}: EstimateCosmosGasLimitInput): Promise<bigint | undefined> => {
  const coin = getKeysignCoin<CosmosChain>(keysignPayload)
  const { chain } = coin
  const { hexPublicKey } = shouldBePresent(keysignPayload.coin)

  const result = await attempt(async () => {
    const txBytes = buildSimulateTxBytes({
      walletCore,
      chain,
      hexPublicKey,
      fromAddress: coin.address,
      toAddress: keysignPayload.toAddress,
      amount: keysignPayload.toAmount,
      denom: cosmosFeeCoinDenom[chain],
      memo: keysignPayload.memo,
      accountNumber,
      sequence,
    })

    const gasUsed = await simulateCosmosGas({ chain, txBytes })

    return scaleCosmosGasLimit(gasUsed)
  })

  return 'data' in result ? result.data : undefined
}
