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
 * Extract the native `balance` integer from a Blockchair dashboard body as a
 * precise string, straight off the raw JSON text.
 *
 * `JSON.parse` (and `response.json()`) coerce numeric literals to JS `number`,
 * which silently truncates anything past `Number.MAX_SAFE_INTEGER`
 * (~9.0e15 base units). For high-supply UTXO chains that is reachable in
 * practice — a single Dogecoin whale address can hold > 30e9 DOGE = 3e18 base
 * units, well past the safe-integer ceiling — so feeding `response.json()`'s
 * already-lossy `number` into `BigInt()` would publish a wrong satoshi figure.
 * We therefore read the integer off the raw text before any numberification.
 *
 * Scoped to the first `"address":{ … "balance":<int> … }` block, which is the
 * native balance of the (single) requested address in a dashboards/address
 * response.
 */
const extractBalanceSatoshis = (rawBody: string): bigint => {
  // Match the balance integer that lives inside the `address` object, not the
  // `balance_usd` float and not any per-utxo value.
  const match = rawBody.match(/"address"\s*:\s*\{[^}]*?"balance"\s*:\s*(-?\d+)/)
  return match ? BigInt(match[1]) : 0n
}

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

  // Read the raw body so we can pull the balance integer at full precision
  // (see extractBalanceSatoshis); `response.json()` numberifies and would
  // truncate large UTXO balances past Number.MAX_SAFE_INTEGER.
  const rawBody = await response.text()
  let json: BlockchairDashboardResponse
  try {
    json = JSON.parse(rawBody) as BlockchairDashboardResponse
  } catch {
    throw new Error(`getUtxoBalance: Blockchair returned non-JSON for ${chain} address ${address}.`)
  }
  const addrData = Object.values(json.data ?? {})[0]
  // null balance (unseen address) → 0; otherwise extract the exact integer.
  const satoshis = addrData?.address?.balance == null ? 0n : extractBalanceSatoshis(rawBody)

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
