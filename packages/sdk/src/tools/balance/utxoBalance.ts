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
  context?: {
    code?: unknown
    error?: unknown
  }
  data: Record<string, { address: { balance: number | null } }>
}

const isSupportedUtxoChain = (chain: UtxoChain): chain is UtxoBalanceChain =>
  (supportedUtxoBalanceChains as readonly UtxoChain[]).includes(chain)

const isJsonObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const hasOwn = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key)

const skipWhitespace = (rawBody: string, start: number): number => {
  let position = start
  while (/\s/.test(rawBody[position] ?? '')) position += 1
  return position
}

const skipJsonString = (rawBody: string, start: number): number => {
  let position = start + 1
  while (position < rawBody.length) {
    if (rawBody[position] === '\\') {
      position += 2
      continue
    }
    if (rawBody[position] === '"') return position + 1
    position += 1
  }
  return position
}

const skipJsonValue = (rawBody: string, start: number): number => {
  let position = skipWhitespace(rawBody, start)
  const first = rawBody[position]

  if (first === '"') return skipJsonString(rawBody, position)

  if (first === '[') {
    position = skipWhitespace(rawBody, position + 1)
    while (rawBody[position] !== ']') {
      position = skipWhitespace(rawBody, skipJsonValue(rawBody, position))
      if (rawBody[position] === ',') position = skipWhitespace(rawBody, position + 1)
    }
    return position + 1
  }

  if (first === '{') {
    position = skipWhitespace(rawBody, position + 1)
    const seenKeys = new Set<string>()
    while (rawBody[position] !== '}') {
      const keyStart = position
      const keyEnd = skipJsonString(rawBody, keyStart)
      const key = JSON.parse(rawBody.slice(keyStart, keyEnd)) as string
      if (seenKeys.has(key)) throw new Error(`duplicate JSON property "${key}"`)
      seenKeys.add(key)
      position = skipWhitespace(rawBody, keyEnd)
      position = skipWhitespace(rawBody, position + 1)
      position = skipWhitespace(rawBody, skipJsonValue(rawBody, position))
      if (rawBody[position] === ',') position = skipWhitespace(rawBody, position + 1)
    }
    return position + 1
  }

  while (position < rawBody.length && !/[\s,\]}]/.test(rawBody[position])) position += 1
  return position
}

type JsonPathResult = {
  end: number
  token?: string
}

const findRawJsonValueAtPath = (
  rawBody: string,
  start: number,
  path: readonly string[],
  pathIndex: number
): JsonPathResult => {
  let position = skipWhitespace(rawBody, start)
  if (rawBody[position] !== '{') {
    return { end: skipJsonValue(rawBody, position) }
  }

  position = skipWhitespace(rawBody, position + 1)
  const seenKeys = new Set<string>()
  let token: string | undefined

  while (rawBody[position] !== '}') {
    const keyStart = position
    const keyEnd = skipJsonString(rawBody, keyStart)
    const key = JSON.parse(rawBody.slice(keyStart, keyEnd)) as string
    if (seenKeys.has(key)) throw new Error(`duplicate JSON property "${key}"`)
    seenKeys.add(key)
    position = skipWhitespace(rawBody, keyEnd)
    position = skipWhitespace(rawBody, position + 1)

    if (key === path[pathIndex]) {
      const valueStart = position
      if (pathIndex === path.length - 1) {
        position = skipJsonValue(rawBody, valueStart)
        token = rawBody.slice(valueStart, position).trim()
      } else {
        const nested = findRawJsonValueAtPath(rawBody, valueStart, path, pathIndex + 1)
        position = nested.end
        token = nested.token
      }
    } else {
      position = skipJsonValue(rawBody, position)
    }

    position = skipWhitespace(rawBody, position)
    if (rawBody[position] === ',') position = skipWhitespace(rawBody, position + 1)
  }

  return { end: position + 1, token }
}

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
 * The traversal follows decoded JSON property names to the exact requested
 * address. This keeps unrelated/nested balances and escaped keys from
 * redirecting extraction, and rejects duplicate keys instead of relying on
 * JSON.parse's last-key-wins behavior.
 */
const extractBalanceToken = (rawBody: string, address: string): string | undefined =>
  findRawJsonValueAtPath(rawBody, 0, ['data', address, 'address', 'balance'], 0).token

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
  // (see extractBalanceToken); `response.json()` numberifies and would
  // truncate large UTXO balances past Number.MAX_SAFE_INTEGER.
  const rawBody = await response.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody) as unknown
  } catch {
    throw new Error(`getUtxoBalance: Blockchair returned non-JSON for ${chain} address ${address}.`)
  }

  const invalidResponse = (reason: string): never => {
    throw new Error(`getUtxoBalance: invalid Blockchair response for ${chain} address ${address}: ${reason}.`)
  }

  if (!isJsonObject(parsed)) invalidResponse('expected an object')
  const json = parsed as BlockchairDashboardResponse
  if (hasOwn(json, 'context')) {
    const context = json.context
    if (!isJsonObject(context)) invalidResponse('malformed provider context')
    const providerContext = context as Record<string, unknown>
    const providerCode = providerContext.code
    const providerError = providerContext.error
    if ((providerCode !== undefined && providerCode !== 200) || (providerError != null && providerError !== '')) {
      invalidResponse(`provider error${providerCode === undefined ? '' : ` (code ${String(providerCode)})`}`)
    }
  }
  if (!isJsonObject(json.data)) invalidResponse('missing data')

  const addrData = json.data[address]
  if (!isJsonObject(addrData)) invalidResponse('missing requested address data')
  if (!isJsonObject(addrData.address)) invalidResponse('missing requested address record')
  if (!hasOwn(addrData.address, 'balance')) invalidResponse('missing balance')

  let balanceToken: string | undefined
  try {
    balanceToken = extractBalanceToken(rawBody, address)
  } catch (error) {
    invalidResponse(error instanceof Error ? error.message : 'ambiguous JSON structure')
  }
  const exactBalanceToken = balanceToken ?? invalidResponse('missing balance token')

  const parsedBalance = addrData.address.balance
  let satoshis: bigint
  if (parsedBalance === null) {
    if (exactBalanceToken !== 'null') invalidResponse('invalid null balance')
    satoshis = 0n
  } else {
    if (typeof parsedBalance !== 'number' || !/^(?:0|[1-9]\d*)$/.test(exactBalanceToken)) {
      invalidResponse('balance must be a plain nonnegative integer or null')
    }
    satoshis = BigInt(exactBalanceToken)
  }

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
