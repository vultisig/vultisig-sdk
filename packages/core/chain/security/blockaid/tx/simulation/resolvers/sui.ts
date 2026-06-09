import { OtherChain } from '@vultisig/core-chain/Chain'

import { queryBlockaid } from '../../../core/query'
import { BlockaidSuiSimulation } from '../api/core'
import { BlockaidTxSimulationResolver } from '../resolver'

type SuiBlockaidScanResponse = {
  simulation: BlockaidSuiSimulation
}

/**
 * Asks Blockaid's `/sui/transaction/scan` endpoint for the simulation block
 * only. The same endpoint also serves validation (security risk) — the
 * separate `getSuiTxBlockaidValidation` resolver requests that.
 */
export const getSuiTxBlockaidSimulation: BlockaidTxSimulationResolver<
  OtherChain.Sui,
  'sui'
> = async ({ data }) => {
  const { simulation } = await queryBlockaid<SuiBlockaidScanResponse>(
    '/sui/transaction/scan',
    data
  )
  return simulation
}
