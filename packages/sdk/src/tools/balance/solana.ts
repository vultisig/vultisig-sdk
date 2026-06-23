import { solanaRpcUrl } from '@vultisig/core-chain/chains/solana/client'

const LAMPORTS_PER_SOL = 1_000_000_000

/** Native SOL balance for a Solana address. */
export type SolBalance = {
  /** The queried owner address (base58). */
  address: string
  /** Raw balance in lamports (1 SOL = 1e9 lamports). */
  lamports: number
  /** Human-readable SOL amount (trailing zeros trimmed). */
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
  /** Derived associated token account (empty string when the owner holds no account for the mint). */
  ata: string
  /** Owning token program (SPL Token vs Token-2022); empty when no account exists. */
  tokenProgram: string
  /** Raw balance in the token's base units (string to preserve u64 precision). */
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

async function solanaRpc<T>(method: string, params: unknown[]): Promise<T> {
  const response = await fetch(solanaRpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })

  if (!response.ok) {
    throw new Error(`Solana RPC ${method} failed: HTTP ${response.status}`)
  }

  const json = (await response.json()) as SolanaRpcResponse<T>
  if (json.error) {
    throw new Error(`Solana RPC ${method} error: ${json.error.message}`)
  }

  return json.result
}

/** Trim trailing zeros (and a dangling decimal point) from a fixed-decimal string. */
const trimZeros = (s: string): string => s.replace(/0+$/, '').replace(/\.$/, '')

/**
 * Query the native SOL balance of a Solana address.
 *
 * @example
 * ```ts
 * const { sol, lamports } = await getSolBalance('GThUX1Atko4tqhN2NaiTazWSeFWMuiUvfFnyJyUghFMJ')
 * ```
 */
export const getSolBalance = async (address: string): Promise<SolBalance> => {
  const result = await solanaRpc<{ value: number }>('getBalance', [address])
  const lamports = result.value
  const sol = trimZeros((lamports / LAMPORTS_PER_SOL).toFixed(9))

  return {
    address,
    lamports,
    sol: sol === '' ? '0' : sol,
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
 * Auto-detects the token program (SPL Token vs Token-2022) and derives the
 * associated token account via `getTokenAccountsByOwner` (jsonParsed). Returns a
 * zero balance with empty `ata`/`tokenProgram` when the owner holds no account
 * for the mint.
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

  const acc = accounts[0]
  const parsed = acc.account.data.parsed.info

  return {
    address,
    mint,
    ata: acc.pubkey,
    tokenProgram: acc.account.data.program,
    balance: parsed.tokenAmount.amount,
    decimals: parsed.tokenAmount.decimals,
    asOf,
  }
}
