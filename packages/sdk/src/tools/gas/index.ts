// Cosmos gas-fee primitives (pure crypto: compute gas limit + fee label).
export type { CosmosSwapFeeLabelOpts } from './cosmos'
export {
  COSMOS_GAS_PRICE,
  COSMOS_SWAP_FEE_LABEL_CHAINS,
  COSMOS_SWAP_GAS_LIMIT,
  estimateCosmosSwapFeeLabel,
  getCosmosGasLimit,
  getCosmosSwapGasLimit,
} from './cosmos'
