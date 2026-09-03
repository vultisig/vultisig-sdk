import { Chain } from '@vultisig/core-chain/Chain'
import { type ChainKind, type DeriveChainKind, getChainKind } from '@vultisig/core-chain/ChainKind'

export type BlockExplorerEntity = 'address' | 'tx'

export type ChainExplorerDescriptor = {
  readonly baseUrl: string
  readonly paths: Readonly<Record<BlockExplorerEntity, `/${string}`>>
}

/**
 * Public, consumer-facing metadata for one chain.
 *
 * Explorer metadata is the first migrated descriptor slice. Additional
 * protocol facts can be added here as their existing exhaustive tables are
 * migrated; product rollout policy remains consumer-owned.
 */
export type ChainDescriptor<C extends Chain = Chain> = {
  readonly chain: C
  readonly kind: DeriveChainKind<C>
  readonly explorer: ChainExplorerDescriptor
}

export type ChainDescriptorRegistry = {
  readonly [C in Chain]: ChainDescriptor<C>
}

const descriptor = <C extends Chain>(
  chain: C,
  baseUrl: string,
  addressPath: `/${string}`,
  txPath: `/${string}`
): ChainDescriptor<C> =>
  Object.freeze({
    chain,
    kind: getChainKind(chain),
    explorer: Object.freeze({
      baseUrl,
      paths: Object.freeze({
        address: addressPath,
        tx: txPath,
      }),
    }),
  })

const cosmosBlockExplorer = 'https://www.mintscan.io'

/**
 * Exhaustive SDK-owned chain metadata.
 *
 * Adding a member to {@link Chain} fails compilation here until its descriptor
 * is present. Consumers should derive projections from this registry instead
 * of copying the chain union or maintaining parallel metadata tables.
 */
export const chainRegistry = Object.freeze({
  [Chain.Bitcoin]: descriptor(Chain.Bitcoin, 'https://mempool.space', '/address/', '/tx/'),
  [Chain.BitcoinCash]: descriptor(
    Chain.BitcoinCash,
    'https://blockchair.com/bitcoin-cash',
    '/address/',
    '/transaction/'
  ),
  [Chain.Litecoin]: descriptor(Chain.Litecoin, 'https://blockchair.com/litecoin', '/address/', '/transaction/'),
  [Chain.Dogecoin]: descriptor(Chain.Dogecoin, 'https://blockchair.com/dogecoin', '/address/', '/transaction/'),
  [Chain.Dash]: descriptor(Chain.Dash, 'https://blockchair.com/dash', '/address/', '/transaction/'),
  [Chain.Solana]: descriptor(Chain.Solana, 'https://solscan.io', '/address/', '/tx/'),
  [Chain.Ethereum]: descriptor(Chain.Ethereum, 'https://etherscan.io', '/address/', '/tx/'),
  [Chain.Cosmos]: descriptor(Chain.Cosmos, `${cosmosBlockExplorer}/cosmos`, '/address/', '/tx/'),
  [Chain.Dydx]: descriptor(Chain.Dydx, `${cosmosBlockExplorer}/dydx`, '/address/', '/tx/'),
  [Chain.Avalanche]: descriptor(Chain.Avalanche, 'https://snowtrace.io', '/address/', '/tx/'),
  [Chain.BSC]: descriptor(Chain.BSC, 'https://bscscan.com', '/address/', '/tx/'),
  [Chain.Arbitrum]: descriptor(Chain.Arbitrum, 'https://arbiscan.io', '/address/', '/tx/'),
  [Chain.Base]: descriptor(Chain.Base, 'https://basescan.org', '/address/', '/tx/'),
  [Chain.Optimism]: descriptor(Chain.Optimism, 'https://optimistic.etherscan.io', '/address/', '/tx/'),
  [Chain.Polygon]: descriptor(Chain.Polygon, 'https://polygonscan.com', '/address/', '/tx/'),
  [Chain.Blast]: descriptor(Chain.Blast, 'https://blastscan.io', '/address/', '/tx/'),
  [Chain.CronosChain]: descriptor(Chain.CronosChain, 'https://cronoscan.com', '/address/', '/tx/'),
  [Chain.Sui]: descriptor(Chain.Sui, 'https://suiscan.xyz/mainnet', '/address/', '/tx/'),
  [Chain.Polkadot]: descriptor(Chain.Polkadot, 'https://assethub-polkadot.subscan.io', '/account/', '/extrinsic/'),
  [Chain.Bittensor]: descriptor(Chain.Bittensor, 'https://taostats.io', '/account/', '/extrinsic/'),
  [Chain.Zksync]: descriptor(Chain.Zksync, 'https://explorer.zksync.io', '/address/', '/tx/'),
  [Chain.Ton]: descriptor(Chain.Ton, 'https://tonviewer.com', '/', '/transaction/'),
  [Chain.Osmosis]: descriptor(Chain.Osmosis, `${cosmosBlockExplorer}/osmosis`, '/address/', '/tx/'),
  [Chain.Terra]: descriptor(Chain.Terra, `${cosmosBlockExplorer}/terra`, '/address/', '/tx/'),
  [Chain.TerraClassic]: descriptor(Chain.TerraClassic, 'https://finder.terra.money/classic', '/address/', '/tx/'),
  [Chain.Noble]: descriptor(Chain.Noble, `${cosmosBlockExplorer}/noble`, '/address/', '/tx/'),
  [Chain.Ripple]: descriptor(Chain.Ripple, 'https://xrpscan.com', '/account/', '/transaction/'),
  [Chain.THORChain]: descriptor(Chain.THORChain, 'https://thorchain.net', '/address/', '/tx/'),
  [Chain.MayaChain]: descriptor(Chain.MayaChain, 'https://www.explorer.mayachain.info', '/address/', '/tx/'),
  [Chain.Akash]: descriptor(Chain.Akash, `${cosmosBlockExplorer}/akash`, '/address/', '/tx/'),
  [Chain.Tron]: descriptor(Chain.Tron, 'https://tronscan.org/#', '/address/', '/transaction/'),
  [Chain.Zcash]: descriptor(Chain.Zcash, 'https://blockexplorer.one/zcash/mainnet', '/address/', '/tx/'),
  [Chain.Cardano]: descriptor(Chain.Cardano, 'https://cardanoscan.io', '/address/', '/transaction/'),
  [Chain.Mantle]: descriptor(Chain.Mantle, 'https://explorer.mantle.xyz', '/address/', '/tx/'),
  [Chain.Hyperliquid]: descriptor(Chain.Hyperliquid, 'https://hypurrscan.io/evm', '/address/', '/tx/'),
  [Chain.Sei]: descriptor(Chain.Sei, 'https://seiscan.io', '/address/', '/tx/'),
  [Chain.Robinhood]: descriptor(Chain.Robinhood, 'https://robinhoodchain.blockscout.com', '/address/', '/tx/'),
  [Chain.QBTC]: descriptor(Chain.QBTC, 'https://explorer.qbtc.net/qbtc', '/account/', '/tx/'),
} as const satisfies ChainDescriptorRegistry)

/** Build an exhaustive consumer projection without copying the chain set. */
export const deriveFromChainRegistry = <T>(
  derive: (descriptor: ChainDescriptor, chain: Chain) => T
): Record<Chain, T> =>
  Object.fromEntries(Object.values(Chain).map(chain => [chain, derive(chainRegistry[chain], chain)])) as Record<
    Chain,
    T
  >

export type ChainExtensionRecord = Readonly<Record<Chain, unknown>>

export type ExtendedChainRegistry<Extensions extends ChainExtensionRecord> = {
  readonly [C in Chain]: (typeof chainRegistry)[C] & {
    readonly extension: Extensions[C]
  }
}

/**
 * Attach consumer-local policy or presentation fields without forking SDK
 * metadata. The extension record is exhaustive, so a new SDK chain produces a
 * compile error until the consumer marks it supported or explicitly unsupported.
 */
export const extendChainRegistry = <const Extensions extends ChainExtensionRecord>(
  extensions: Extensions
): ExtendedChainRegistry<Extensions> =>
  deriveFromChainRegistry(descriptor => {
    if (!Object.prototype.hasOwnProperty.call(extensions, descriptor.chain)) {
      throw new Error(`Missing chain extension for ${descriptor.chain}`)
    }

    return {
      ...descriptor,
      extension: extensions[descriptor.chain],
    }
  }) as ExtendedChainRegistry<Extensions>

export type { ChainKind }
