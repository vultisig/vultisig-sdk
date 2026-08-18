/**
 * Server-built card surfaces
 *
 * The agent-backend negotiates rich "cards" with the client via the
 * `supported_surfaces` request field (see backend
 * internal/service/agent/types.go SendMessageRequest.SupportedSurfaces). When
 * the client advertises a surface, the backend emits a typed `data-<surface>`
 * SSE part and strips the raw payload from the model-visible tool result so the
 * LLM narrates instead of echoing JSON.
 *
 * When the client does NOT advertise a surface, the backend falls back to the
 * legacy path where the model echoes the `card_payload` JSON verbatim into the
 * message content (the #341/#582 raw-JSON-in-the-terminal incidents, and the
 * rj3p class-bug: `yield_opportunities` / `polymarket_markets` weren't
 * advertised, so `find me yield opportunities for USDC` dumped raw
 * `{"surface":"yield_opportunities",...}` JSON into the terminal).
 *
 * This module owns the surfaces the CLI renders today — `balance_summary`,
 * `yield_opportunities`, `polymarket_markets` — plus the defensive fallback
 * that pretty-renders a card envelope if the legacy verbatim-echo path ever
 * fires (older backend, or a backend that ignores the advertised surface).
 */
import chalk from 'chalk'

/** Surface keys the CLI declares it can render. Sent as `supported_surfaces`. */
export const CLI_SUPPORTED_SURFACES = [
  'balance_summary',
  'turn_outcome',
  'yield_opportunities',
  'polymarket_markets',
] as const

/**
 * Typed turn-outcome discriminator (agent-backend a2a-02). The backend emits a
 * single `data-turn_outcome` SSE part once at turn end WHEN the client advertises
 * the `turn_outcome` surface. It lets a headless `agent ask` caller tell four
 * endings apart WITHOUT parsing prose: a genuine success, a fund-safety guardrail
 * deliberately blocking the action, the model refusing / asking a clarifying
 * question, or an infrastructure error. `code` is a machine code (guardrail
 * category / error class); `detail` is a short, safe human hint (never a prose dump).
 */
export type TurnOutcomeKind = 'success' | 'blocked' | 'refusal' | 'error'
export type TurnOutcome = {
  kind: TurnOutcomeKind
  code?: string
  detail?: string
}

/** Narrowing parser for a raw `data-turn_outcome` payload off the wire. Returns
 *  null for anything that isn't a well-formed outcome so a malformed frame can't
 *  flip an exit code — the caller then falls back to its default classification. */
export function parseTurnOutcome(raw: unknown): TurnOutcome | null {
  if (!raw || typeof raw !== 'object') return null
  const kind = (raw as { kind?: unknown }).kind
  if (kind !== 'success' && kind !== 'blocked' && kind !== 'refusal' && kind !== 'error') return null
  const code = (raw as { code?: unknown }).code
  const detail = (raw as { detail?: unknown }).detail
  return {
    kind,
    ...(typeof code === 'string' ? { code } : {}),
    ...(typeof detail === 'string' ? { detail } : {}),
  }
}

export type BalanceSummaryToken = {
  symbol: string
  amountDecimal: string
  amountUsd?: string
}

export type BalanceSummaryAccount = {
  chainId: string
  address: string
  tokens: BalanceSummaryToken[]
}

export type BalanceSummaryCard = {
  surface: 'balance_summary'
  accounts: BalanceSummaryAccount[]
  stale?: boolean
  staleSecs?: number
}

export type HlOrderConfirmationCard = {
  surface: 'hyperliquid_order_confirmation'
  status: 'confirmation_required'
  order_ref: string
  operation: 'open' | 'close'
  coin: string
  asset_index: number
  side: 'long' | 'short'
  size: string
  notional_usd: string
  leverage?: number
  margin_mode?: 'cross' | 'isolated'
  order_type: 'market' | 'limit'
  price_cap: string
  limit_price: string | null
  tif: 'Ioc' | 'Gtc' | 'Alo'
  reduce_only: boolean
  proposed: string
}

export type AgentCard = BalanceSummaryCard | HlOrderConfirmationCard

/**
 * Strip terminal control bytes (C0 0x00–0x1F, DEL 0x7F, C1 0x80–0x9F) from a
 * value before it can reach the TTY. Card string fields flow from
 * attacker-influenced sources — token `symbol`/`chainId` come from on-chain
 * metadata (a scam token can pick any symbol), and on the legacy-echo fallback
 * path `JSON.parse` decodes an escape into a real ESC byte. Every ANSI/OSC
 * escape sequence requires one of these introducer bytes, so removing the range
 * neutralizes cursor-move / OSC 8 hyperlink-spoof / OSC 52 clipboard-write
 * injection into the balances table while leaving all printable text (incl.
 * Unicode) intact. Done at the parse boundary so both the typed-SSE and
 * legacy-echo render paths defend in depth rather than trusting the backend
 * sanitizer (balance_summary_sanitize.go) — the fallback exists precisely for
 * backends that don't sanitize.
 */
function stripControlChars(s: string): string {
  let out = ''
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) continue
    out += ch
  }
  return out
}

function asString(v: unknown): string {
  return typeof v === 'string' ? stripControlChars(v) : ''
}

function parseToken(v: unknown): BalanceSummaryToken | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const symbol = asString(o.symbol)
  const amountDecimal = asString(o.amountDecimal)
  if (!symbol && !amountDecimal) return null
  const token: BalanceSummaryToken = { symbol, amountDecimal }
  const amountUsd = asString(o.amountUsd)
  if (amountUsd) token.amountUsd = amountUsd
  return token
}

function parseAccount(v: unknown): BalanceSummaryAccount | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const chainId = asString(o.chainId)
  if (!chainId) return null
  const tokensRaw = Array.isArray(o.tokens) ? o.tokens : []
  const tokens = tokensRaw.map(parseToken).filter((t): t is BalanceSummaryToken => t !== null)
  return { chainId, address: asString(o.address) || '—', tokens }
}

/**
 * Validate + coerce an arbitrary value into a {@link BalanceSummaryCard}.
 * Returns null when it isn't a balance_summary envelope with at least one
 * renderable account. Mirrors the backend's allow-listing
 * (balance_summary_sanitize.go) so a malformed/foreign payload is rejected
 * rather than rendered.
 */
export function parseBalanceSummaryEnvelope(value: unknown): BalanceSummaryCard | null {
  if (!value || typeof value !== 'object') return null
  const o = value as Record<string, unknown>
  if (o.surface !== 'balance_summary') return null
  if (!Array.isArray(o.accounts)) return null
  const accounts = o.accounts.map(parseAccount).filter((a): a is BalanceSummaryAccount => a !== null)
  if (accounts.length === 0) return null
  const card: BalanceSummaryCard = { surface: 'balance_summary', accounts }
  // staleSecs is only meaningful (and only rendered) alongside stale, so keep
  // it gated on the stale flag rather than letting it orphan when stale is unset.
  if (o.stale === true) {
    card.stale = true
    if (typeof o.stale_secs === 'number') card.staleSecs = o.stale_secs
  }
  return card
}

/** Find the matching `}` for the `{` at `start`, respecting JSON strings. */
function matchBrace(text: string, start: number): number {
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/**
 * Legacy-path fallback: detect a balance_summary card envelope embedded in
 * assistant message content (the model echoing `card_payload` verbatim, possibly
 * inside a ```json code fence or surrounded by prose) and return both the parsed
 * card and the message text with the JSON blob removed. Returns null when no
 * card envelope is present, so normal prose passes through untouched.
 */
export function extractBalanceSummaryFromText(
  content: string
): { card: BalanceSummaryCard; remainingText: string } | null {
  if (!content || !content.includes('balance_summary')) return null

  // Backstop against adversarial input: matchBrace is O(n) per `{`, so a crafted
  // blob of deeply nested braces makes the scan O(n²). A real echoed card is
  // small (a few KB); a single assistant message this large is pathological, so
  // bail and let the raw text print rather than pin the CPU.
  if (content.length > 200_000) return null

  // Scan every `{`-delimited object; the envelope may sit inside a code fence
  // or be wrapped in prose. Take the first one that parses as a balance card.
  for (let i = content.indexOf('{'); i !== -1; i = content.indexOf('{', i + 1)) {
    const end = matchBrace(content, i)
    if (end === -1) break
    const blob = content.slice(i, end + 1)
    if (!blob.includes('balance_summary')) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(blob)
    } catch {
      continue
    }
    const card = parseBalanceSummaryEnvelope(parsed)
    if (!card) continue
    // Remove the JSON blob (and any enclosing ```json fence) from the text.
    const before = content.slice(0, i).replace(/```(?:json)?\s*$/i, '')
    const after = content.slice(end + 1).replace(/^\s*```/, '')
    const remainingText = (before + after).trim()
    return { card, remainingText }
  }
  return null
}

function shortenAddress(address: string): string {
  if (!address || address === '—') return address || '—'
  if (address.length <= 16) return address
  return `${address.slice(0, 8)}…${address.slice(-6)}`
}

/** Parse a USD string ("$4,500.00", "4500") into a number, or null. */
function parseUsd(amountUsd?: string): number | null {
  if (!amountUsd) return null
  const cleaned = amountUsd.replace(/[$,\s]/g, '')
  if (!cleaned) return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

function formatUsd(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * Render a balance_summary card as a terminal table. Replaces the legacy
 * raw-JSON dump with a human-readable breakdown grouped by chain, with a USD
 * total when amounts are priced.
 */
export function renderBalanceSummaryCard(card: BalanceSummaryCard): string {
  const lines: string[] = []
  const staleCue = card.stale
    ? chalk.gray(` (stale${card.staleSecs ? ` ~${Math.round(card.staleSecs / 60)}m` : ''}, refreshing…)`)
    : ''
  lines.push(chalk.bold('  Balances') + staleCue)

  let total = 0
  let sawUsd = false

  for (const account of card.accounts) {
    lines.push(`  ${chalk.cyan(account.chainId)} ${chalk.gray(`(${shortenAddress(account.address)})`)}`)
    if (account.tokens.length === 0) {
      lines.push(chalk.gray('    (no balances)'))
      continue
    }
    for (const token of account.tokens) {
      const usd = parseUsd(token.amountUsd)
      if (usd !== null) {
        total += usd
        sawUsd = true
      }
      const symbol = token.symbol.padEnd(10)
      const amount = token.amountDecimal.padStart(16)
      const usdCol = token.amountUsd ? chalk.gray(`  ${token.amountUsd}`) : ''
      lines.push(`    ${chalk.bold(symbol)}${amount}${usdCol}`)
    }
  }

  if (sawUsd) {
    lines.push(chalk.gray('  ' + '─'.repeat(36)))
    lines.push(`  ${chalk.bold('Total')}  ${chalk.green(formatUsd(total))}`)
  }

  return lines.join('\n')
}

// ============================================================================
// yield_opportunities (rj3p)
// ============================================================================

export type YieldOpportunity = {
  id: string
  chain: string
  symbol: string
  apy?: string
  provider?: string
  type?: string
}

export type YieldOpportunitiesCard = {
  surface: 'yield_opportunities'
  title?: string
  opportunities: YieldOpportunity[]
}

// Live backend envelope (yield_search tool, observed via miniforum dogfood,
// rj3p): `token`/`network` are plain strings, not nested objects, and `apy` is
// already a percentage number (4.99 = 4.99%), not a 0..1 fraction. Accept
// `symbol`/`chain` as aliases too — the field names the backend uses for this
// surface aren't contractually pinned from this repo, so parse defensively.
function parseYieldOpportunity(v: unknown): YieldOpportunity | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const id = asString(o.id)
  const symbol = asString(o.token) || asString(o.symbol)
  const chain = asString(o.network) || asString(o.chain)
  if (!symbol) return null
  const opportunity: YieldOpportunity = { id, chain, symbol }
  const apy = o.apy
  if (typeof apy === 'number' && Number.isFinite(apy)) {
    opportunity.apy = `${apy.toFixed(2)}%`
  } else if (typeof apy === 'string' && apy) {
    opportunity.apy = stripControlChars(apy)
  }
  const provider = asString(o.provider)
  if (provider) opportunity.provider = provider
  const type = asString(o.type)
  if (type) opportunity.type = type
  return opportunity
}

/**
 * Validate + coerce an arbitrary value into a {@link YieldOpportunitiesCard}.
 * Returns null when it isn't a yield_opportunities envelope with at least one
 * renderable opportunity, mirroring {@link parseBalanceSummaryEnvelope}.
 */
export function parseYieldOpportunitiesEnvelope(value: unknown): YieldOpportunitiesCard | null {
  if (!value || typeof value !== 'object') return null
  const o = value as Record<string, unknown>
  if (o.surface !== 'yield_opportunities') return null
  const raw = Array.isArray(o.opportunities) ? o.opportunities : Array.isArray(o.data) ? o.data : []
  const opportunities = raw.map(parseYieldOpportunity).filter((y): y is YieldOpportunity => y !== null)
  if (opportunities.length === 0) return null
  const card: YieldOpportunitiesCard = { surface: 'yield_opportunities', opportunities }
  const title = asString(o.title)
  if (title) card.title = title
  return card
}

/**
 * Render a yield_opportunities card as prose — one line per opportunity —
 * instead of the raw envelope JSON.
 */
export function renderYieldOpportunitiesCard(card: YieldOpportunitiesCard): string {
  const lines: string[] = [chalk.bold(`  ${card.title || 'Yield opportunities'}`)]
  for (const opp of card.opportunities) {
    const label = opp.symbol || opp.id || 'opportunity'
    const apyCol = opp.apy ? chalk.green(`  ${opp.apy} APY`) : ''
    const chainCol = opp.chain ? chalk.gray(`  (${opp.chain})`) : ''
    const providerCol = opp.provider ? chalk.gray(`  via ${opp.provider}`) : ''
    lines.push(`    ${chalk.bold(label)}${apyCol}${chainCol}${providerCol}`)
  }
  return lines.join('\n')
}

/**
 * Legacy-path fallback: detect a yield_opportunities envelope embedded in
 * assistant message content and return both the parsed card and the message
 * text with the JSON blob removed. Mirrors
 * {@link extractBalanceSummaryFromText}.
 */
export function extractYieldOpportunitiesFromText(
  content: string
): { card: YieldOpportunitiesCard; remainingText: string } | null {
  return extractSurfaceFromText(content, 'yield_opportunities', parseYieldOpportunitiesEnvelope)
}

// ============================================================================
// polymarket_markets (rj3p)
// ============================================================================

export type PolymarketOutcome = {
  name: string
  price?: string
}

export type PolymarketMarket = {
  id: string
  question: string
  volume?: string
  endDate?: string
  outcomes: PolymarketOutcome[]
}

export type PolymarketMarketsCard = {
  surface: 'polymarket_markets'
  title?: string
  subtitle?: string
  markets: PolymarketMarket[]
}

/** Format a 0.0–1.0 implied-probability fraction as a whole-percent string.
 *  Returns undefined for non-finite / out-of-range values (e.g. Polymarket's
 *  collapsed "extreme outcome" markets at 0 or 1) so the caller can elide the
 *  price rather than render nonsense. Mirrors the app's PolymarketMarketsCardRenderer
 *  formatPrice. */
function formatProbability(v: unknown): string | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined
  if (v <= 0 || v >= 1) return undefined
  return `${Math.round(v * 100)}%`
}

/**
 * Synthesize the outcome rows this file's renderer expects (`{ name, price }[]`)
 * from the real envelope fields `yesPrice`/`noPrice`/`topOutcome`. Binary
 * YES/NO markets render a YES row (and a NO row when noPrice is present);
 * multi-outcome markets (numOutcomes > 2) instead carry `topOutcome` — the
 * leading outcome NAME — so we render one row labeled with that name and
 * priced from `yesPrice`, mirroring the app's PolymarketMarketsCardRenderer
 * (topOutcome replaces the YES/NO label, yesPrice stays the displayed price).
 */
function buildPolymarketOutcomes(o: Record<string, unknown>): PolymarketOutcome[] {
  const yesPrice = formatProbability(o.yesPrice)
  const noPrice = formatProbability(o.noPrice)
  const topOutcome = asString(o.topOutcome)
  if (topOutcome) {
    const outcome: PolymarketOutcome = { name: topOutcome }
    if (yesPrice) outcome.price = yesPrice
    return [outcome]
  }
  const outcomes: PolymarketOutcome[] = []
  if (yesPrice) outcomes.push({ name: 'YES', price: yesPrice })
  if (noPrice) outcomes.push({ name: 'NO', price: noPrice })
  return outcomes
}

// Live backend envelope (polymarket_search tool; cross-checked against the
// app's PolymarketMarketsCardSchema signingCards.ts and agent-backend-ts's
// PolymarketMarketRow / cardContracts.ts, surface_json_leak spike): rows carry
// `yesPrice`/`noPrice` — 0..1 implied-probability fractions — and `topOutcome`
// for multi-outcome markets, NOT a nested `outcomes[]` array. Volume is
// `volume24h`, not `volume`.
function parsePolymarketMarket(v: unknown): PolymarketMarket | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const question = asString(o.question) || asString(o.title)
  if (!question) return null
  const id = asString(o.id) || asString(o.slug)
  const outcomes = buildPolymarketOutcomes(o)
  const market: PolymarketMarket = { id, question, outcomes }
  const volume24h = o.volume24h
  if (typeof volume24h === 'number' && Number.isFinite(volume24h)) {
    market.volume = formatUsd(volume24h)
  } else if (typeof volume24h === 'string' && volume24h) {
    market.volume = stripControlChars(volume24h)
  }
  const endDate = asString(o.endDate) || asString(o.end_date)
  if (endDate) market.endDate = endDate
  return market
}

/**
 * Validate + coerce an arbitrary value into a {@link PolymarketMarketsCard}.
 * Returns null when it isn't a polymarket_markets envelope with at least one
 * renderable market, mirroring {@link parseBalanceSummaryEnvelope}.
 */
export function parsePolymarketMarketsEnvelope(value: unknown): PolymarketMarketsCard | null {
  if (!value || typeof value !== 'object') return null
  const o = value as Record<string, unknown>
  if (o.surface !== 'polymarket_markets') return null
  const raw = Array.isArray(o.markets) ? o.markets : Array.isArray(o.data) ? o.data : []
  const markets = raw.map(parsePolymarketMarket).filter((m): m is PolymarketMarket => m !== null)
  if (markets.length === 0) return null
  const card: PolymarketMarketsCard = { surface: 'polymarket_markets', markets }
  const title = asString(o.title)
  if (title) card.title = title
  const subtitle = asString(o.subtitle)
  if (subtitle) card.subtitle = subtitle
  return card
}

/**
 * Render a polymarket_markets card as prose — one block per market — instead
 * of the raw envelope JSON.
 */
export function renderPolymarketMarketsCard(card: PolymarketMarketsCard): string {
  const lines: string[] = [chalk.bold(`  ${card.title || 'Polymarket markets'}`)]
  // subtitle carries backend-generated count-honesty text (e.g. "Showing 8 of
  // 10 markets…") — must not be dropped, mirrors how title falls through.
  if (card.subtitle) lines.push(chalk.gray(`  ${card.subtitle}`))
  for (const market of card.markets) {
    const metaBits = [market.volume ? `${market.volume} vol` : '', market.endDate ? `ends ${market.endDate}` : '']
      .filter(Boolean)
      .join(', ')
    lines.push(`    ${chalk.bold(market.question)}${metaBits ? chalk.gray(`  (${metaBits})`) : ''}`)
    for (const outcome of market.outcomes) {
      const priceCol = outcome.price ? chalk.gray(`  ${outcome.price}`) : ''
      lines.push(`      ${outcome.name}${priceCol}`)
    }
  }
  return lines.join('\n')
}

/**
 * Legacy-path fallback: detect a polymarket_markets envelope embedded in
 * assistant message content and return both the parsed card and the message
 * text with the JSON blob removed. Mirrors
 * {@link extractBalanceSummaryFromText}.
 */
export function extractPolymarketMarketsFromText(
  content: string
): { card: PolymarketMarketsCard; remainingText: string } | null {
  return extractSurfaceFromText(content, 'polymarket_markets', parsePolymarketMarketsEnvelope)
}

/**
 * Shared legacy-echo extractor: scan `content` for a `{`-delimited object that
 * mentions `surfaceKey` and parses as a well-formed envelope via `parser`.
 * Generalizes {@link extractBalanceSummaryFromText}'s brace-scan so each
 * surface doesn't reimplement the same O(n) scan / size backstop / fence
 * stripping.
 */
function extractSurfaceFromText<T>(
  content: string,
  surfaceKey: string,
  parser: (value: unknown) => T | null
): { card: T; remainingText: string } | null {
  if (!content || !content.includes(surfaceKey)) return null

  // Same pathological-input backstop as extractBalanceSummaryFromText.
  if (content.length > 200_000) return null

  for (let i = content.indexOf('{'); i !== -1; i = content.indexOf('{', i + 1)) {
    const end = matchBrace(content, i)
    if (end === -1) break
    const blob = content.slice(i, end + 1)
    if (!blob.includes(surfaceKey)) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(blob)
    } catch {
      continue
    }
    const card = parser(parsed)
    if (!card) continue
    const before = content.slice(0, i).replace(/```(?:json)?\s*$/i, '')
    const after = content.slice(end + 1).replace(/^\s*```/, '')
    const remainingText = (before + after).trim()
    return { card, remainingText }
  }
  return null
}
