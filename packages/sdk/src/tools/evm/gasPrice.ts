import { EvmChain } from '@vultisig/core-chain/Chain'
import { getEvmClient } from '@vultisig/core-chain/chains/evm/client'

export type EvmGasPrice = {
  /** Chain the gas price was fetched for. */
  chain: EvmChain
  /** Current gas price in wei (raw, exact). */
  gasPriceWei: bigint
  /**
   * Current gas price in gwei, rounded to 4 decimals for display.
   *
   * Display-only — NEVER use this for math; use the exact `gasPriceWei`
   * bigint. A non-zero wei price below the 4-decimal display floor
   * (< 0.00005 gwei = 50_000 wei) is clamped UP to the smallest renderable
   * 0.0001 gwei rather than rounded down to a misleading `0`.
   */
  gasPriceGwei: number
}

/** 1 gwei = 1e9 wei. */
const WEI_PER_GWEI = 1_000_000_000n
/** Smallest gwei value renderable at 4 decimals. */
const GWEI_DISPLAY_FLOOR = 0.0001

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

  // wei → gwei for DISPLAY only. The exact value always lives in `gasPriceWei`
  // (a true bigint, never round-tripped through a JS number). We derive the
  // gwei magnitude from the bigint first so `Number()` never sees the large
  // wei value, then round to 4 decimals. A naive `Number(wei) / 1e9` would
  // silently collapse any non-zero gas price below the display floor (e.g.
  // 49_999 wei) to `0`, which on an L2 reads as "free gas" — misleading.
  // Clamp a genuinely non-zero price UP to the smallest renderable value.
  const rounded = parseFloat((Number(gasPriceWei) / Number(WEI_PER_GWEI)).toFixed(4))
  const gasPriceGwei = rounded === 0 && gasPriceWei > 0n ? GWEI_DISPLAY_FLOOR : rounded

  return { chain, gasPriceWei, gasPriceGwei }
}
