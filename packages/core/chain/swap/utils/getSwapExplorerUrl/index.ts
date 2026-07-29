import { Chain } from '@vultisig/core-chain/Chain'
import { getCowSwapExplorerOrderUrl } from '@vultisig/core-chain/swap/general/cowswap/getCowSwapExplorerOrderUrl'
import { generalSwapProviders } from '@vultisig/core-chain/swap/general/GeneralSwapProvider'
import { getSwapKitTrackerUrl } from '@vultisig/core-chain/swap/general/swapkit/getSwapKitTrackerUrl'
import { getBlockExplorerUrl } from '@vultisig/core-chain/utils/getBlockExplorerUrl'

/**
 * Swap-provider scanners covered by `getSwapExplorerUrl`.
 *
 * - `li.fi` → scan.li.fi (or orb.helius.dev for Solana settlement)
 * - `swapkit` → track.swapkit.dev
 * - `cowswap` → explorer.cow.fi order page
 * - `thorchain` / `mayachain` → native chain scanner
 * - `1inch`, `kyber`, `jupiter` → source-chain explorer fallback
 *
 * Keep this union in sync with iOS `ExplorerLinkBuilder.swift` and Android
 * `ExplorerLinkRepository.getSwapProgressLink`.
 */
export const swapExplorerProviders = [...generalSwapProviders, 'mayachain', 'thorchain'] as const

export type SwapExplorerProvider = (typeof swapExplorerProviders)[number]

export type GetSwapExplorerUrlInput = {
  provider: SwapExplorerProvider
  /**
   * The provider-specific tracking identifier. This is an on-chain transaction
   * hash for every provider except CowSwap, where it must be the 56-byte order
   * UID returned when the off-chain order is submitted.
   */
  txHash: string
  /** The source chain. Unsupported CowSwap chains throw at runtime. */
  fromChain: Chain
}

const stripHexPrefix = (value: string): string =>
  value.startsWith('0x') || value.startsWith('0X') ? value.slice(2) : value

/**
 * Resolve the canonical "view on explorer" URL for a swap-provider transaction.
 *
 * Mirrors iOS `ExplorerLinkBuilder.swift` and Android `ExplorerLinkRepository.getSwapProgressLink`
 * so every consumer (vultisig-windows, vultiagent-app, future RN SDK) routes
 * tx-history links to the same scanner.
 *
 * For aggregators without a public per-tx page (`1inch`, `kyber`, `jupiter`),
 * the source-chain explorer is returned so the row never renders as a dead link.
 */
export const getSwapExplorerUrl = ({ provider, txHash, fromChain }: GetSwapExplorerUrlInput): string => {
  switch (provider) {
    case 'cowswap':
      return getCowSwapExplorerOrderUrl({ chain: fromChain, uid: txHash })
    case 'li.fi':
      // LI.FI's scanner has no per-tx page for Solana cross-chain settlement;
      // Helius is the canonical view there.
      if (fromChain === Chain.Solana) {
        return `https://orb.helius.dev/tx/${txHash}`
      }
      return `https://scan.li.fi/tx/${txHash}`
    case 'thorchain':
      return `https://runescan.io/tx/${stripHexPrefix(txHash)}`
    case 'mayachain':
      return `https://www.explorer.mayachain.info/tx/${stripHexPrefix(txHash)}`
    case 'swapkit':
      return (
        getSwapKitTrackerUrl({ chain: fromChain, txHash }) ??
        getBlockExplorerUrl({ chain: fromChain, entity: 'tx', value: txHash })
      )
    case '1inch':
    case 'kyber':
    case 'jupiter':
      // No public aggregator scanner. Source-chain explorer keeps the link
      // useful (Etherscan / Solscan / etc.) without fabricating a URL.
      return getBlockExplorerUrl({ chain: fromChain, entity: 'tx', value: txHash })
    default: {
      // Compile-time guard: if `swapExplorerProviders` grows without a matching
      // case here, TS narrows `provider` to `never` and fails the build. The
      // runtime throw covers the (impossible-by-types) JS-caller path.
      const _exhaustive: never = provider
      throw new Error(`Unknown swap explorer provider: ${String(_exhaustive)}`)
    }
  }
}
