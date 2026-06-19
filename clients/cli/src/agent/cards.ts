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
 * message content (the #341/#582 raw-JSON-in-the-terminal incidents). The CLI
 * historically advertised nothing, so a balance query dumped raw card JSON.
 *
 * This module owns the one surface the CLI renders today — `balance_summary` —
 * plus the defensive fallback that pretty-renders a card envelope if the legacy
 * verbatim-echo path ever fires (older backend, or a backend that ignores the
 * advertised surface).
 */
import chalk from 'chalk'

/** Surface keys the CLI declares it can render. Sent as `supported_surfaces`. */
export const CLI_SUPPORTED_SURFACES = ['balance_summary'] as const

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

function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
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
  if (o.stale === true) card.stale = true
  if (typeof o.stale_secs === 'number') card.staleSecs = o.stale_secs
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
