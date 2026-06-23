import { EvmChain } from '@vultisig/core-chain/Chain'
import { getEvmClient } from '@vultisig/core-chain/chains/evm/client'

export type EvmGasPrice = {
  /** Chain the gas price was fetched for. */
  chain: EvmChain
  /** Current gas price in wei (raw, exact). */
  gasPriceWei: bigint
  /** Current gas price in gwei, rounded to 4 decimals for display. */
  gasPriceGwei: number
}

/**
 * Fetch the current gas price for a single EVM chain via `eth_gasPrice`.
 *
 * Pure read — uses the SDK's own per-chain RPC client (no extra config, no
 * external API). Returns the raw wei value (exact `bigint`) plus a `gwei`
 * convenience field for display. USD estimation is intentionally NOT part of
 * this primitive: it needs a price oracle, which is an orchestration concern.
 *
 * @example
 * ```ts
 * const gp = await evmGasPrice('Ethereum')
 * // => { chain: 'Ethereum', gasPriceWei: 12345678901n, gasPriceGwei: 12.3457 }
 * ```
 */
export const evmGasPrice = async (chain: EvmChain): Promise<EvmGasPrice> => {
  const client = getEvmClient(chain)
  const gasPriceWei = await client.getGasPrice()

  // wei → gwei (1 gwei = 1e9 wei). Number() is safe here: gwei magnitudes for
  // EVM gas prices stay far below Number.MAX_SAFE_INTEGER. We keep the exact
  // value in `gasPriceWei` for any caller that needs precision.
  const gasPriceGwei = parseFloat((Number(gasPriceWei) / 1e9).toFixed(4))

  return { chain, gasPriceWei, gasPriceGwei }
}
