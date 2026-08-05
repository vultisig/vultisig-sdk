import { ChainKind, getChainKind } from '@vultisig/core-chain/ChainKind'

import { broadcastFailed, BroadcastTxResolver, isBroadcastTxResult, isRetryableBroadcastCause } from './resolver'
import { broadcastBittensorTx } from './resolvers/bittensor'
import { broadcastCardanoTx } from './resolvers/cardano'
import { broadcastCosmosTx } from './resolvers/cosmos'
import { broadcastEvmTx } from './resolvers/evm'
import { broadcastPolkadotTx } from './resolvers/polkadot'
import { broadcastQbtcTx } from './resolvers/qbtc'
import { broadcastRippleTx } from './resolvers/ripple'
import { broadcastSolanaTx } from './resolvers/solana'
import { broadcastSuiTx } from './resolvers/sui'
import { broadcastTonTx } from './resolvers/ton'
import { broadcastTronTx } from './resolvers/tron'
import { broadcastUtxoTx } from './resolvers/utxo'

const resolvers: Record<ChainKind, BroadcastTxResolver<any>> = {
  bittensor: broadcastBittensorTx,
  cardano: broadcastCardanoTx,
  cosmos: broadcastCosmosTx,
  evm: broadcastEvmTx,
  polkadot: broadcastPolkadotTx,
  qbtc: broadcastQbtcTx,
  ripple: broadcastRippleTx,
  solana: broadcastSolanaTx,
  sui: broadcastSuiTx,
  ton: broadcastTonTx,
  utxo: broadcastUtxoTx,
  tron: broadcastTronTx,
}

export type {
  BroadcastAcceptedResult,
  BroadcastFailedResult,
  BroadcastProviderDetails,
  BroadcastTxResolver,
  BroadcastTxResult,
} from './resolver'
export { BroadcastErrorCode } from './resolver'

export const broadcastTx: BroadcastTxResolver = async input => {
  try {
    const result = await resolvers[getChainKind(input.chain)](input)
    if (isBroadcastTxResult(result)) return result

    return broadcastFailed(new Error('Broadcast resolver returned an invalid result'), false, {
      provider: result,
    })
  } catch (cause) {
    // The public boundary is total even if a future resolver forgets to
    // normalize an exception. Default to non-retryable unless the cause is a
    // recognizable transport failure; blindly retrying an ambiguous signed
    // transaction can double-submit it.
    return broadcastFailed(cause, isRetryableBroadcastCause(cause))
  }
}
