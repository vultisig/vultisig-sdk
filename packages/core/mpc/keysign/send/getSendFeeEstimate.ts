import { Chain } from '@vultisig/core-chain/Chain'
import { getFeeAmount } from '@vultisig/core-mpc/keysign/fee'
import { getBlockchainSpecificValue } from '@vultisig/core-mpc/keysign/chainSpecific/KeysignChainSpecific'
import { getKeysignChain } from '@vultisig/core-mpc/keysign/utils/getKeysignChain'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'

import { buildSendKeysignPayload, BuildSendKeysignPayloadInput } from './build'

export const getSendFeeEstimate = async (
  input: BuildSendKeysignPayloadInput
): Promise<bigint> => {
  const keysignPayload = await buildSendKeysignPayload(input)

  if (getKeysignChain(keysignPayload) === Chain.QBTC) {
    const cosmosSpecific = getBlockchainSpecificValue(
      keysignPayload.blockchainSpecific,
      'cosmosSpecific'
    )
    return cosmosSpecific.gas
  }

  return getFeeAmount({
    keysignPayload,
    walletCore: input.walletCore,
    publicKey: shouldBePresent(
      input.publicKey,
      'publicKey required for fee estimate on this chain'
    ),
  })
}
