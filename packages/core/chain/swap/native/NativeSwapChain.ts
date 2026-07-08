import { Chain } from '@vultisig/core-chain/Chain'
import { cosmosRpcUrl } from '@vultisig/core-chain/chains/cosmos/cosmosRpcUrl'
import { withoutDuplicates } from '@vultisig/lib-utils/array/withoutDuplicates'

export const nativeSwapChains = [Chain.THORChain, Chain.MayaChain] as const
export type NativeSwapChain = (typeof nativeSwapChains)[number]

/** THORChain rapid swap (`streaming_interval=0`). Streaming retry uses interval `1`. */
export const nativeSwapStreamingInterval: Record<NativeSwapChain, number> = {
  [Chain.THORChain]: 0,
  [Chain.MayaChain]: 3,
}

/**
 * THORChain-only: when a rapid quote's `fees.total_bps` exceeds this, fetch a streaming quote and pick the better outcome.
 * Set to `Number.MAX_SAFE_INTEGER` to disable streaming fallback without removing code.
 */
export const THORCHAIN_STREAMING_SLIPPAGE_THRESHOLD_BPS = 100

export const nativeSwapApiBaseUrl: Record<NativeSwapChain, string> = {
  [Chain.THORChain]: `${cosmosRpcUrl[Chain.THORChain]}/thorchain`,
  [Chain.MayaChain]: `${cosmosRpcUrl[Chain.MayaChain]}/mayachain`,
}

const thorChainSwapEnabledChains = [
  Chain.Avalanche,
  Chain.BitcoinCash,
  Chain.BSC,
  Chain.Bitcoin,
  Chain.Dogecoin,
  Chain.Ethereum,
  Chain.Cosmos,
  Chain.Litecoin,
  Chain.THORChain,
  Chain.Ripple,
  Chain.Base,
  Chain.Solana,
  Chain.Tron,
  Chain.Noble,
] as const

export const nativeSwapEnabledChainsRecord = {
  [Chain.THORChain]: thorChainSwapEnabledChains,
  [Chain.MayaChain]: [
    Chain.MayaChain,
    Chain.THORChain,
    Chain.Kujira,
    Chain.Ethereum,
    Chain.Dash,
    Chain.Bitcoin,
    Chain.Arbitrum,
    Chain.Zcash,
    // Live Available ADA.ADA pool confirmed on mayanode (~4,795 ADA,
    // mayanode.mayachain.info/mayachain/pools). Review follow-up (fund-safety
    // pass): unlike SwapKit's Sui/Cardano corridors, the SDK's own
    // buildSwapKeysignPayload -> getCardanoSigningInputs path IS already
    // wired end-to-end for a signable Cardano deposit (memo -> CIP-20 aux
    // data), so this is NOT inert groundwork the way the comment here
    // originally implied. getNativeSwapQuote (api/getNativeSwapQuote.ts) now
    // rejects Cardano as a source BEFORE the network call, mirroring
    // getSwapKitQuote's guard, until a real deposit confirms MayaChain's
    // Cardano bifrost observer actually reads the CIP-20 label as the
    // routing memo.
    Chain.Cardano,
  ],
} as const

type NativeSwapEnabledChain = (typeof nativeSwapEnabledChainsRecord)[NativeSwapChain][number]

export const nativeSwapEnabledChains = withoutDuplicates(
  Object.values(nativeSwapEnabledChainsRecord).flatMap(value => value)
) as NativeSwapEnabledChain[]

export const nativeSwapChainIds = {
  [Chain.Avalanche]: 'AVAX',
  [Chain.BitcoinCash]: 'BCH',
  [Chain.BSC]: 'BSC',
  [Chain.Bitcoin]: 'BTC',
  [Chain.Dogecoin]: 'DOGE',
  [Chain.Ethereum]: 'ETH',
  [Chain.Cosmos]: 'GAIA',
  [Chain.Litecoin]: 'LTC',
  [Chain.THORChain]: 'THOR',
  [Chain.MayaChain]: 'MAYA',
  [Chain.Kujira]: 'KUJI',
  [Chain.Dash]: 'DASH',
  [Chain.Arbitrum]: 'ARB',
  [Chain.Zcash]: 'ZEC',
  [Chain.Ripple]: 'XRP',
  [Chain.Base]: 'BASE',
  [Chain.Solana]: 'SOL',
  [Chain.Tron]: 'TRON',
  [Chain.Noble]: 'NOBLE',
  [Chain.Cardano]: 'ADA',
} satisfies Record<NativeSwapEnabledChain, string>
export type NativeSwapChainId = (typeof nativeSwapChainIds)[NativeSwapEnabledChain]

type NativeSwapPayloadCase = 'thorchainSwapPayload' | 'mayachainSwapPayload'

export const nativeSwapPayloadCase: Record<NativeSwapChain, NativeSwapPayloadCase> = {
  [Chain.THORChain]: 'thorchainSwapPayload',
  [Chain.MayaChain]: 'mayachainSwapPayload',
}
