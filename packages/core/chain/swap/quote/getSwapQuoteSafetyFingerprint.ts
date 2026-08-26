import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
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
  if (Array.isArray(value)) {
    return `[${Array.from({ length: value.length }, (_, index) =>
      index in value && value[index] !== undefined ? canonicalize(value[index]) : '{"$undefined":true}'
    ).join(',')}]`
  }

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
        // `$...` is reserved for canonical type tags above. Escape real object
        // keys in that namespace so, for example, `5n` cannot collide with a
        // provider object shaped like `{ $bigint: '5' }`.
        .map(key => `${JSON.stringify(key.startsWith('$') ? `$${key}` : key)}:${canonicalize(record[key])}`)
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
 * Detects accidental mutation and stale or mismatched reuse by binding a
 * canonical quote to the exact request identity and signable transaction it
 * was returned with. This unkeyed digest is not an authenticity boundary.
 * Pure and platform-neutral so preparation can recompute the same value before
 * any wallet/key/payload work.
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
