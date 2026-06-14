import { CosmosChain } from '@vultisig/core-chain/Chain'

import { getCustomRpcOverride } from '../customRpc/customRpcOverrides'
import { cosmosRpcUrl } from './cosmosRpcUrl'

/**
 * Resolves the LCD/REST base URL for a Cosmos chain, honoring an app-wide
 * custom RPC override when one is set and falling back to the default endpoint
 * otherwise. Byte-identical to the default when no override is configured.
 */
export const getCosmosRpcUrl = (chain: CosmosChain): string => getCustomRpcOverride(chain) ?? cosmosRpcUrl[chain]
