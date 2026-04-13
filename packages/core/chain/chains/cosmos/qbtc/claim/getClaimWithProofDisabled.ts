import { qbtcRestUrl } from '@vultisig/core-chain/chains/cosmos/qbtc/tendermintRpcUrl'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

type QbtcParamsResponse = {
  param: {
    key: string
    value: string
  }
}

/** Checks whether the ClaimWithProof feature is disabled on the QBTC chain. */
export const getClaimWithProofDisabled = async (): Promise<boolean> => {
  const url = `${qbtcRestUrl}/qbtc/v1/params/ClaimWithProofDisabled`

  const { param } = await queryUrl<QbtcParamsResponse>(url)

  return Number(param.value) > 0
}
