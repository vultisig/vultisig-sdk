import { UtxoChain } from '@vultisig/core-chain/Chain'

/**
 * UTXO chains supported by {@link getUtxoBalance}.
 *
 * Scoped to the 5 Blockchair-backed Bitcoin-derivatives. Zcash is part of the
 * broader {@link UtxoChain} enum but is intentionally excluded here (shielded
 * balances are not represented by the public dashboard endpoint).
 */
export const supportedUtxoBalanceChains = [
  UtxoChain.Bitcoin,
  UtxoChain.Litecoin,
  UtxoChain.Dogecoin,
  UtxoChain.BitcoinCash,
  UtxoChain.Dash,
] as const

export type UtxoBalanceChain = (typeof supportedUtxoBalanceChains)[number]

const TICKER: Record<UtxoBalanceChain, string> = {
  [UtxoChain.Bitcoin]: 'BTC',
  [UtxoChain.Litecoin]: 'LTC',
  [UtxoChain.Dogecoin]: 'DOGE',
  [UtxoChain.BitcoinCash]: 'BCH',
  [UtxoChain.Dash]: 'DASH',
}

/**
 * UTXO native asset decimals. All five chains use 8 decimals (satoshi-scale).
 */
const UTXO_DECIMALS = 8

/**
 * Default Blockchair base — the public Vultisig API proxy
 * (`api.vultisig.com/blockchair/<chain>`). This is the same canonical,
 * key-managed endpoint mcp-ts reads through; hitting api.blockchair.com
 * directly is rate-limited (HTTP 430) without a server-side API key.
 */
const DEFAULT_BLOCKCHAIR_BASE = 'https://api.vultisig.com/blockchair'
const DEFAULT_TIMEOUT_MS = 30_000

export type UtxoBalance = {
  chain: UtxoBalanceChain
  address: string
  symbol: string
  /** Balance in base units (satoshis / litoshis / etc.) as a string to avoid precision loss. */
  satoshis: string
  /** Human-readable balance, fixed to {@link UTXO_DECIMALS} decimal places. */
  balance: string
}

export type GetUtxoBalanceOptions = {
  /**
   * Blockchair API base URL. Override to point at a different proxy/mirror
   * or a direct (api-keyed) `https://api.blockchair.com`.
   * Defaults to the Vultisig proxy `https://api.vultisig.com/blockchair`.
   */
  blockchairBase?: string
  /** Per-request timeout in ms. Defaults to 30_000. */
  timeoutMs?: number
}

/**
 * Map a {@link UtxoBalanceChain} to its Blockchair URL path segment.
 * Blockchair uses lowercase, hyphenated paths (e.g. `bitcoin-cash`).
 */
const blockchairPath = (chain: UtxoBalanceChain): string => chain.toLowerCase()

type BlockchairDashboardResponse = {
  data: Record<string, { address: { balance: number | null } }>
}

const isSupportedUtxoChain = (chain: UtxoChain): chain is UtxoBalanceChain =>
  (supportedUtxoBalanceChains as readonly UtxoChain[]).includes(chain)

/**
 * Read the native balance of a UTXO-based chain address via the public
 * Blockchair dashboards API. Read-only, no vault/keys required.
 *
 * Supported chains: Bitcoin, Litecoin, Dogecoin, Bitcoin-Cash, Dash.
 *
 * @example
 * ```ts
 * import { UtxoChain } from '@vultisig/core-chain/Chain'
 *
 * const bal = await getUtxoBalance(UtxoChain.Bitcoin, '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')
 * // => { chain: 'Bitcoin', address: '1A1zP1...', symbol: 'BTC', satoshis: '6824924', balance: '0.06824924' }
 * ```
 */
export const getUtxoBalance = async (
  chain: UtxoChain,
  address: string,
  options: GetUtxoBalanceOptions = {}
): Promise<UtxoBalance> => {
  if (!isSupportedUtxoChain(chain)) {
    throw new Error(
      `getUtxoBalance: unsupported chain "${chain}". Supported: ${supportedUtxoBalanceChains.join(', ')}.`
    )
  }
  if (!address) {
    throw new Error('getUtxoBalance: address is required.')
  }

  const base = options.blockchairBase ?? DEFAULT_BLOCKCHAIR_BASE
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const url = `${base.replace(/\/+$/, '')}/${blockchairPath(chain)}/dashboards/address/${encodeURIComponent(address)}`

  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!response.ok) {
    throw new Error(`getUtxoBalance: Blockchair returned ${response.status} for ${chain} address ${address}.`)
  }

  const json = (await response.json()) as BlockchairDashboardResponse
  const addrData = Object.values(json.data ?? {})[0]
  const satoshis = BigInt(addrData?.address?.balance ?? 0)

  return {
    chain,
    address,
    symbol: TICKER[chain],
    satoshis: satoshis.toString(),
    balance: formatUtxoBalance(satoshis),
  }
}

/**
 * Format a base-unit (satoshi) amount to a fixed-decimal human string,
 * without floating-point precision loss.
 */
export const formatUtxoBalance = (satoshis: bigint): string => {
  const negative = satoshis < 0n
  const abs = negative ? -satoshis : satoshis
  const divisor = 10n ** BigInt(UTXO_DECIMALS)
  const whole = abs / divisor
  const frac = (abs % divisor).toString().padStart(UTXO_DECIMALS, '0')
  return `${negative ? '-' : ''}${whole.toString()}.${frac}`
}
