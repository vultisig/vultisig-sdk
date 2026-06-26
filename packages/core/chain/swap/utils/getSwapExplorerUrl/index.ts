import { Chain } from '@vultisig/core-chain/Chain'
import { getBlockExplorerUrl } from '@vultisig/core-chain/utils/getBlockExplorerUrl'

/**
 * Swap-provider scanners covered by `getSwapExplorerUrl`.
 *
 * - `li.fi` → scan.li.fi (or orb.helius.dev for Solana settlement)
 * - `thorchain` / `mayachain` → native chain scanner
 * - `1inch`, `jupiter`, `kyber`, `swapkit` → no per-tx aggregator page; fall back to source-chain explorer
 *
 * Keep this union in sync with iOS `ExplorerLinkBuilder.swift` and Android
 * `ExplorerLinkRepository.getSwapProgressLink`.
 */
export const swapExplorerProviders = [
  '1inch',
  'jupiter',
  'kyber',
  'li.fi',
  'mayachain',
  'swapkit',
  'thorchain',
] as const

export type SwapExplorerProvider = (typeof swapExplorerProviders)[number]

export type GetSwapExplorerUrlInput = {
  provider: SwapExplorerProvider
  txHash: string
  /**
   * The chain the tx was broadcast on. Used both for source-chain fallback and
   * for the Solana-settlement branch on `li.fi` (where the LI.FI scanner has
   * no per-tx page).
   */
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
 * For aggregators without a public per-tx page (`1inch`, `jupiter`, `kyber`, `swapkit`),
 * the source-chain explorer is returned so the row never renders as a dead link.
 */
export const getSwapExplorerUrl = ({ provider, txHash, fromChain }: GetSwapExplorerUrlInput): string => {
  switch (provider) {
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
    case '1inch':
    case 'jupiter':
    case 'kyber':
    case 'swapkit':
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
