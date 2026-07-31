import { bech32, bech32m } from '@scure/base'
import bs58check from 'bs58check'

import { isValidCashAddr } from '../../utils/cashaddr'

export type UtxoChainName = 'Bitcoin' | 'Litecoin' | 'Dogecoin' | 'Dash' | 'Bitcoin-Cash' | 'Zcash'

const BASE58_VERSION_BYTES: Partial<Record<UtxoChainName, ReadonlySet<number>>> = {
  Bitcoin: new Set([0x00, 0x05]),
  Litecoin: new Set([0x30, 0x32]),
  Dogecoin: new Set([0x1e, 0x16]),
  Dash: new Set([0x4c, 0x10]),
}

const BECH32_HRP: Partial<Record<UtxoChainName, string>> = {
  Bitcoin: 'bc',
  Litecoin: 'ltc',
}

function hasExpectedBech32Hrp(address: string, expectedHrp: string): boolean {
  if (address !== address.toLowerCase()) return false

  for (const codec of [bech32, bech32m]) {
    try {
      if (codec.decode(address as `${string}1${string}`).prefix === expectedHrp) return true
    } catch {
      // Try the other checksum variant, then the non-bech32 formats below.
    }
  }

  return false
}

function hasExpectedBase58Version(address: string, chain: UtxoChainName): boolean {
  let decoded: Uint8Array
  try {
    decoded = bs58check.decode(address)
  } catch {
    return false
  }

  if (chain === 'Zcash') {
    return decoded.length === 22 && decoded[0] === 0x1c && (decoded[1] === 0xb8 || decoded[1] === 0xbd)
  }

  const versions = BASE58_VERSION_BYTES[chain]
  return decoded.length === 21 && decoded[0] !== undefined && versions?.has(decoded[0]) === true
}

/**
 * Return whether a checksummed UTXO address carries the brand for `chain`.
 *
 * This validates chain identity, not whether every branded script type is
 * spendable by the current transaction builder. The policy is intentionally
 * mainnet-only:
 * - Bitcoin / Litecoin: Bech32/Bech32m HRP or exact Base58Check version byte
 * - Dogecoin / Dash: exact Base58Check version byte
 * - Bitcoin Cash: checksummed mainnet CashAddr
 * - Zcash: transparent t1/t3 two-byte Base58Check versions
 *
 * Ambiguous legacy Bitcoin Cash and Litecoin P2SH encodings are excluded so a
 * Bitcoin-looking address is never accepted for another chain by accident.
 */
export function isUtxoAddressBrandValid(address: string, chain: UtxoChainName): boolean {
  const normalized = address.trim()
  if (normalized === '') return false

  if (chain === 'Bitcoin-Cash') return isValidCashAddr(normalized)

  const expectedHrp = BECH32_HRP[chain]
  if (expectedHrp && hasExpectedBech32Hrp(normalized, expectedHrp)) return true

  return hasExpectedBase58Version(normalized, chain)
}

/** Fail closed when an address is malformed or belongs to another UTXO chain. */
export function assertUtxoAddressBrand(address: string, chain: UtxoChainName): void {
  if (!isUtxoAddressBrandValid(address, chain)) {
    throw new Error(`UTXO address brand mismatch: expected a valid ${chain} address`)
  }
}
