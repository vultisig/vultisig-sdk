import { Chain, CosmosChain, EvmChain, OtherChain, UtxoChain } from '@vultisig/core-chain/Chain'
import { getCosmosChainId } from '@vultisig/core-chain/chains/cosmos/chainInfo'
import { getEvmChainId } from '@vultisig/core-chain/chains/evm/chainInfo'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { hexToNumber } from '@vultisig/lib-utils/hex/hexToNumber'
import { isOneOf } from '@vultisig/lib-utils/array/isOneOf'

/**
 * Branded CAIP-2 chain identifier. Derived from {@link Chain}, not a re-key of
 * the enum: `Record<Chain, T>` exhaustiveness stays on the existing enum.
 */
export type ChainId = string & { readonly __brand: 'ChainId' }

/**
 * Branded CAIP-19 asset identifier. Native assets are `{chainId}/native:{ticker}`
 * so same-ticker collisions (LUNA on Terra vs TerraClassic) stay distinct.
 */
export type AssetId = string & { readonly __brand: 'AssetId' }

const asChainId = (value: string): ChainId => value as ChainId
const asAssetId = (value: string): AssetId => value as AssetId

/**
 * Well-known CAIP-2 references for non-EVM / non-Cosmos families.
 *
 * EVM and Cosmos IDs are computed from the existing exhaustive chain-id tables
 * (`getEvmChainId` / `getCosmosChainId`) so they cannot drift from RPC/LCD
 * identity. These remaining families do not have an equivalent table today.
 */
const otherChainCaip2 = {
  // bip122 genesis is unique per *original* chain, not per fork: BCH shares
  // Bitcoin's genesis, so it cannot reuse the BTC CAIP-2 reference.
  [UtxoChain.Bitcoin]: 'bip122:000000000019d6689c085ae165831e93',
  [UtxoChain.BitcoinCash]: 'bitcoincash:mainnet',
  [UtxoChain.Litecoin]: 'bip122:12a765e31ffd4059bada1e25190f6e98',
  [UtxoChain.Dogecoin]: 'bip122:1a91e3dace36e2be3bf030a65679fe82',
  [UtxoChain.Dash]: 'bip122:00000ffd590b1485b3caadc19b22e637',
  [UtxoChain.Zcash]: 'zcash:main',
  [OtherChain.Solana]: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  [OtherChain.Sui]: 'sui:mainnet',
  [OtherChain.Polkadot]: 'polkadot:91b171bb158e2d3848fa23a9f1c25182',
  [OtherChain.Bittensor]: 'bittensor:finney',
  [OtherChain.Ton]: 'ton:-239',
  [OtherChain.Ripple]: 'xrpl:0',
  [OtherChain.Tron]: 'tron:mainnet',
  [OtherChain.Cardano]: 'cip34:1-764824073',
  [OtherChain.QBTC]: 'cosmos:qbtc-1',
} as const satisfies Record<UtxoChain | OtherChain, string>

const evmChainId = (chain: EvmChain): ChainId => asChainId(`eip155:${hexToNumber(getEvmChainId(chain))}`)

const cosmosChainId = (chain: CosmosChain): ChainId => asChainId(`cosmos:${getCosmosChainId(chain)}`)

/** Frozen CAIP-2 matrix: one unique ChainId per {@link Chain}. */
export const chainIds = Object.freeze(
  Object.fromEntries(
    (Object.values(Chain) as Chain[]).map(chain => {
      if (isOneOf(chain, Object.values(EvmChain))) {
        return [chain, evmChainId(chain)]
      }
      if (isOneOf(chain, Object.values(CosmosChain))) {
        return [chain, cosmosChainId(chain)]
      }
      return [chain, asChainId(otherChainCaip2[chain as UtxoChain | OtherChain])]
    })
  )
) as Readonly<Record<Chain, ChainId>>

export const toChainId = (chain: Chain): ChainId => chainIds[chain]

export const chainFromChainId = (chainId: string): Chain | undefined => {
  for (const chain of Object.values(Chain)) {
    if (chainIds[chain] === chainId) return chain
  }
  return undefined
}

export const isChainId = (value: string): value is ChainId => chainFromChainId(value) !== undefined

export const toNativeAssetId = (chain: Chain): AssetId =>
  asAssetId(`${toChainId(chain)}/native:${chainFeeCoin[chain].ticker}`)

export const toTokenAssetId = (chain: Chain, tokenReference: string): AssetId =>
  asAssetId(`${toChainId(chain)}/token:${tokenReference}`)
