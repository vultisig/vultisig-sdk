import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '@noble/hashes/utils'
import type { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'

import type { SwapQuoteResult } from './SwapQuote'

type Input = {
  from: AccountCoin
  to: AccountCoin
  requestedAmount: bigint
  expiresAt: number
  quote: SwapQuoteResult
}

export const cloneSwapSafetyValue = <T>(value: T): T => {
  if (value === null || typeof value !== 'object') return value
  if (value instanceof Uint8Array) return new Uint8Array(value) as T
  if (Array.isArray(value)) return value.map(cloneSwapSafetyValue) as T

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [
      key,
      cloneSwapSafetyValue(nestedValue),
    ])
  ) as T
}

const canonicalize = (value: unknown): string => {
  if (value === null) return 'null'
  if (value instanceof Uint8Array) return `{"$bytes":${JSON.stringify(bytesToHex(value))}}`
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`

  switch (typeof value) {
    case 'bigint':
      return `{"$bigint":${JSON.stringify(value.toString())}}`
    case 'boolean':
    case 'number':
    case 'string':
      return JSON.stringify(value)
    case 'object': {
      const record = value as Record<string, unknown>
      return `{${Object.keys(record)
        .filter(key => record[key] !== undefined)
        .sort()
        .map(key => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
        .join(',')}}`
    }
    default:
      throw new Error(`Unsupported swap quote safety value: ${typeof value}`)
  }
}

const coinIdentity = ({ chain, address, id, ticker, decimals }: AccountCoin) => ({
  chain,
  address,
  id,
  ticker,
  decimals,
})

/**
 * Integrity-binds a canonical quote to the exact request identity and signable
 * transaction it was returned with. Pure and platform-neutral so preparation
 * can recompute the same value before any wallet/key/payload work.
 */
export const getSwapQuoteSafetyFingerprint = ({ from, to, requestedAmount, expiresAt, quote }: Input): string =>
  bytesToHex(
    sha256(
      new TextEncoder().encode(
        canonicalize({
          version: 1,
          from: coinIdentity(from),
          to: coinIdentity(to),
          requestedAmount,
          expiresAt,
          quote,
        })
      )
    )
  )
