import { Chain, EvmChain } from '@vultisig/core-chain/Chain'

// CoW Explorer network path segments. Mainnet has no segment; the rest are the
// slugs CoW Explorer routes on (https://explorer.cow.fi/<segment>/orders/<uid>).
const cowExplorerNetworkSegment: Partial<Record<Chain, string>> = {
  [EvmChain.Ethereum]: '',
  [EvmChain.Arbitrum]: 'arb1',
  [EvmChain.Base]: 'base',
  [EvmChain.Avalanche]: 'avax',
}

/**
 * Link to a CowSwap order's page on CoW Explorer (keyed by the order UID).
 *
 * Used for the PENDING state, while the off-chain order is still being settled
 * by solvers and there is no on-chain tx hash yet. Once the order is filled the
 * consumer swaps this for the settlement tx's block-explorer link.
 */
export const getCowSwapExplorerOrderUrl = ({ chain, uid }: { chain: Chain; uid: string }): string => {
  const segment = cowExplorerNetworkSegment[chain]
  // `undefined` (unsupported chain) is distinct from `''` (mainnet, no segment).
  // Fail fast rather than silently aliasing an unknown chain to the Ethereum
  // explorer route — CowSwap only ever routes on the chains mapped above.
  if (segment === undefined) {
    throw new Error(`CowSwap explorer URL is not supported for chain: ${chain}`)
  }
  const prefix = segment ? `/${segment}` : ''
  return `https://explorer.cow.fi${prefix}/orders/${uid}`
}
