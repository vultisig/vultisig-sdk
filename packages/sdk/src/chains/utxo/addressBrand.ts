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

const SEGWIT_HRP: Partial<Record<UtxoChainName, string>> = {
  Bitcoin: 'bc',
  Litecoin: 'ltc',
}

function hasExpectedSegwitBrand(address: string, expectedHrp: string): boolean {
  for (const codec of [bech32, bech32m]) {
    try {
      const { prefix, words } = codec.decode(address as `${string}1${string}`)
      const version = words[0]
      if (prefix !== expectedHrp || version === undefined || version > 16) continue

      const program = codec.fromWords(words.slice(1))
      if (program.length < 2 || program.length > 40) continue
      if (version === 0) return codec === bech32 && (program.length === 20 || program.length === 32)
      return codec === bech32m
    } catch {
      // Try the other checksum variant, then the non-SegWit formats below.
    }
  }

  return false
}

function hasExpectedZcashSaplingBrand(address: string): boolean {
  try {
    const decoded = bech32.decode(address as `${string}1${string}`)
    return decoded.prefix === 'zs' && bech32.fromWords(decoded.words).length === 43
  } catch {
    return false
  }
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
 * - Zcash: transparent t1/t3 Base58Check versions or Sapling zs Bech32 HRP
 *
 * Ambiguous legacy Bitcoin Cash and Litecoin P2SH encodings are excluded so a
 * Bitcoin-looking address is never accepted for another chain by accident.
 */
export function isUtxoAddressBrandValid(address: string, chain: UtxoChainName): boolean {
  const normalized = address.trim()
  if (normalized === '') return false

  if (chain === 'Bitcoin-Cash') return isValidCashAddr(normalized)
  if (chain === 'Zcash' && hasExpectedZcashSaplingBrand(normalized)) return true

  const expectedHrp = SEGWIT_HRP[chain]
  if (expectedHrp && hasExpectedSegwitBrand(normalized, expectedHrp)) return true

  return hasExpectedBase58Version(normalized, chain)
}

/** Fail closed when an address is malformed or belongs to another UTXO chain. */
export function assertUtxoAddressBrand(address: string, chain: UtxoChainName): void {
  if (!isUtxoAddressBrandValid(address, chain)) {
    throw new Error(`UTXO address brand mismatch: expected a valid ${chain} address`)
  }
}
