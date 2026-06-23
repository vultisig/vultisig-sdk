import { solanaRpcUrl } from '@vultisig/core-chain/chains/solana/client'

const LAMPORTS_PER_SOL = 1_000_000_000n

/** Native SOL balance for a Solana address. */
export type SolBalance = {
  /** The queried owner address (base58). */
  address: string
  /**
   * Raw balance in lamports (1 SOL = 1e9 lamports) as a JS number. Convenient,
   * but lossy above `Number.MAX_SAFE_INTEGER` (~9.007M SOL) - prefer
   * `lamportsRaw` for exact u64 precision. `sol` is always exact regardless.
   */
  lamports: number
  /** Raw balance in lamports as a base-10 string (lossless u64 precision). */
  lamportsRaw: string
  /** Human-readable SOL amount (trailing zeros trimmed; exact across the u64 range). */
  sol: string
  /** ISO-8601 timestamp the balance was read at. */
  asOf: string
}

/** SPL (or Token-2022) token balance for a Solana address + mint. */
export type SplTokenBalance = {
  /** The owner address (base58). */
  address: string
  /** The token mint address (base58). */
  mint: string
  /**
   * The owner's token account for this mint (empty string when none exists).
   * When the owner holds the mint across several token accounts, this is the
   * largest-balance account; `balance` is the sum across all of them.
   */
  ata: string
  /** Owning token program (SPL Token vs Token-2022); empty when no account exists. */
  tokenProgram: string
  /** Total raw balance across all of the owner's accounts for this mint, in base units (string for u64 precision). */
  balance: string
  /** Token decimals. */
  decimals: number
  /** ISO-8601 timestamp the balance was read at. */
  asOf: string
}

type SolanaRpcResponse<T> = {
  result: T
  error?: { code: number; message: string }
}

/** Raw response text + the parsed JSON (the text is kept to recover u64 values losslessly). */
async function solanaRpcRaw(
  method: string,
  params: unknown[]
): Promise<{ text: string; json: SolanaRpcResponse<unknown> }> {
  const response = await fetch(solanaRpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })

  if (!response.ok) {
    throw new Error(`Solana RPC ${method} failed: HTTP ${response.status}`)
  }

  const text = await response.text()
  const json = JSON.parse(text) as SolanaRpcResponse<unknown>
  if (json.error) {
    throw new Error(`Solana RPC ${method} error: ${json.error.message}`)
  }

  return { text, json }
}

async function solanaRpc<T>(method: string, params: unknown[]): Promise<T> {
  const { json } = await solanaRpcRaw(method, params)
  return json.result as T
}

/**
 * Format a u64 lamport amount as a human SOL string using integer-only math
 * (BigInt), so the result is exact across the full u64 range. Mirrors the Go
 * `FormatLamports` (whole/frac split, trailing zeros trimmed, no dangling dot).
 * A naive `lamports / 1e9` float path corrupts precision once lamports exceeds
 * `Number.MAX_SAFE_INTEGER` (~9.007M SOL), so we never touch floats here.
 */
const formatLamports = (lamports: bigint): string => {
  const whole = lamports / LAMPORTS_PER_SOL
  const frac = lamports % LAMPORTS_PER_SOL
  if (frac === 0n) return whole.toString()
  const fracStr = frac.toString().padStart(9, '0').replace(/0+$/, '')
  return `${whole.toString()}.${fracStr}`
}

/**
 * Query the native SOL balance of a Solana address.
 *
 * @example
 * ```ts
 * const { sol, lamports } = await getSolBalance('GThUX1Atko4tqhN2NaiTazWSeFWMuiUvfFnyJyUghFMJ')
 * ```
 */
export const getSolBalance = async (address: string): Promise<SolBalance> => {
  const { text, json } = await solanaRpcRaw('getBalance', [address])

  // `getBalance.value` is a JSON *number* (u64). `JSON.parse` already rounds it
  // once it exceeds 2^53, so recover the exact integer from the raw response
  // text before any Number coercion can corrupt it.
  const match = text.match(/"value"\s*:\s*(\d+)/)
  if (!match) {
    throw new Error('Solana RPC getBalance: malformed response (no value)')
  }
  const lamportsRaw = match[1]
  const lamportsBig = BigInt(lamportsRaw)

  // Sanity-check the regex against the parsed body in the safe range, so a
  // surprise response shape (extra leading "value" key) can't silently win.
  const parsedValue = (json.result as { value?: unknown } | null)?.value
  if (typeof parsedValue === 'number' && Number.isSafeInteger(parsedValue) && BigInt(parsedValue) !== lamportsBig) {
    throw new Error('Solana RPC getBalance: ambiguous value in response')
  }

  return {
    address,
    lamports: Number(lamportsBig),
    lamportsRaw,
    sol: formatLamports(lamportsBig),
    asOf: new Date().toISOString(),
  }
}

type ParsedTokenAccount = {
  pubkey: string
  account: {
    data: {
      parsed: {
        info: {
          tokenAmount: { amount: string; decimals: number }
          mint: string
        }
        type: string
      }
      program: string
    }
  }
}

/**
 * Query the SPL token balance for a Solana address + mint.
 *
 * Auto-detects the token program (SPL Token vs Token-2022) via
 * `getTokenAccountsByOwner` (jsonParsed). Returns a zero balance with empty
 * `ata`/`tokenProgram` when the owner holds no account for the mint. When the
 * owner holds the mint across multiple token accounts (a canonical ATA plus
 * auxiliary accounts), the balances are summed (lossless u64) so the result is
 * the owner's true total rather than a single, RPC-ordering-dependent account.
 *
 * @example
 * ```ts
 * // USDC on Solana mainnet
 * const { balance, decimals } = await getSplTokenBalance(
 *   'GThUX1Atko4tqhN2NaiTazWSeFWMuiUvfFnyJyUghFMJ',
 *   'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
 * )
 * ```
 */
export const getSplTokenBalance = async (address: string, mint: string): Promise<SplTokenBalance> => {
  const result = await solanaRpc<{ value: ParsedTokenAccount[] }>('getTokenAccountsByOwner', [
    address,
    { mint },
    { encoding: 'jsonParsed' },
  ])

  const accounts = result.value
  const asOf = new Date().toISOString()

  if (!accounts.length) {
    return { address, mint, ata: '', tokenProgram: '', balance: '0', decimals: 0, asOf }
  }

  // The owner can hold the same mint across multiple token accounts (the
  // canonical ATA plus auxiliary accounts). `getTokenAccountsByOwner` returns
  // them all, in an unspecified order, so taking accounts[0] both undercounts
  // the true balance and yields a non-deterministic representative account. Sum
  // every account (lossless via BigInt) and surface the largest as the
  // representative `ata`.
  let total = 0n
  let decimals = accounts[0].account.data.parsed.info.tokenAmount.decimals
  let tokenProgram = accounts[0].account.data.program
  let repPubkey = accounts[0].pubkey
  let repAmount = -1n

  for (const acc of accounts) {
    const parsed = acc.account.data.parsed.info
    // Defensive: the RPC filters by mint, but never trust the balance of an
    // account that doesn't actually belong to the requested mint.
    if (parsed.mint !== mint) continue
    const amount = BigInt(parsed.tokenAmount.amount)
    total += amount
    if (amount > repAmount) {
      repAmount = amount
      repPubkey = acc.pubkey
      decimals = parsed.tokenAmount.decimals
      tokenProgram = acc.account.data.program
    }
  }

  return {
    address,
    mint,
    ata: repPubkey,
    tokenProgram,
    balance: total.toString(),
    decimals,
    asOf,
  }
}
