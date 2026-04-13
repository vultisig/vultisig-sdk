import { BtcAddressType } from './BtcAddressType'

/**
 * Detects the Bitcoin address type from the address string format.
 *
 * | Format              | Type        |
 * |---------------------|-------------|
 * | `1...`              | P2PKH       |
 * | `3...`              | P2SH-P2WPKH |
 * | `bc1q...` (42 chars)| P2WPKH      |
 * | `bc1q...` (>42 chars)| P2WSH      |
 * | `bc1p...`           | P2TR        |
 */
export const detectBtcAddressType = (address: string): BtcAddressType => {
  if (address.startsWith('1')) return 'p2pkh'
  if (address.startsWith('3')) return 'p2sh-p2wpkh'

  if (address.startsWith('bc1p')) return 'p2tr'

  if (address.startsWith('bc1q')) {
    return address.length > 42 ? 'p2wsh' : 'p2wpkh'
  }

  throw new Error(`Unsupported Bitcoin address format: ${address}`)
}
