import { StargateClient } from '@cosmjs/stargate'
import { CosmosChain } from '@vultisig/core-chain/Chain'
import { memoizeAsync } from '@vultisig/lib-utils/memoizeAsync'

import { tendermintRpcUrl } from './tendermintRpcUrl'

// Note: a custom RPC override is treated as an LCD/REST endpoint (see
// getCosmosRpcUrl + the RPC health probe), so it is intentionally NOT applied
// here — the StargateClient speaks Tendermint RPC, a different protocol. The
// override therefore covers the LCD paths (fee, account info, LCD balance
// fallback); this Tendermint client keeps its default endpoint.
export const getCosmosClient = memoizeAsync(async (chain: CosmosChain) =>
  StargateClient.connect(tendermintRpcUrl[chain])
)
