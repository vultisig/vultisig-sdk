import { EvmChain } from '@vultisig/core-chain/Chain'
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
import { withTransientBroadcastRetry } from './transientRetry'

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

const hasResolverOwnedRetry = (chainKind: ChainKind): boolean => chainKind === 'evm' || chainKind === 'solana'

export type {
  BroadcastAcceptedResult,
  BroadcastFailedResult,
  BroadcastProviderDetails,
  BroadcastStrategy,
  BroadcastStrategyInput,
  BroadcastTxInput,
  BroadcastTxResolver,
  BroadcastTxResult,
} from './resolver'
export { BroadcastErrorCode } from './resolver'

export const broadcastTx: BroadcastTxResolver = async input => {
  if (input.strategy === 'raced-public-rpc' && input.chain !== EvmChain.Ethereum) {
    return broadcastFailed(new Error('raced-public-rpc broadcast strategy is only supported for Ethereum'), false)
  }

  const chainKind = getChainKind(input.chain)
  const resolver = resolvers[chainKind]

  const resolveOnce = async () => {
    try {
      const result = await resolver(input)
      if (isBroadcastTxResult(result)) return result

      return broadcastFailed(new Error('Broadcast resolver returned an invalid result'), false, {
        provider: result,
      })
    } catch (cause) {
      return broadcastFailed(cause, isRetryableBroadcastCause(cause))
    }
  }

  if (hasResolverOwnedRetry(chainKind)) {
    return resolveOnce()
  }

  try {
    return await withTransientBroadcastRetry(async () => {
      const result = await resolveOnce()
      if (result.status === 'failed' && result.retryable) throw result

      return result
    })
  } catch (cause) {
    if (isBroadcastTxResult(cause)) return cause
    // The public boundary is total even if a future resolver forgets to
    // normalize an exception. Default to non-retryable unless the cause is a
    // recognizable transport failure; blindly retrying an ambiguous signed
    // transaction can double-submit it.
    return broadcastFailed(cause, isRetryableBroadcastCause(cause))
  }
}
