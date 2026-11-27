import { Chain, chainFeeCoin, isChainOfKind } from '@vultisig/sdk'

import type { SelectedUtxoInput } from '../types'

/**
 * Shorten an address for display
 */
export function shortenAddress(address: string, chars = 4): string {
  if (!address) return ''
  if (address.length <= chars * 2 + 2) return address
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`
}

/**
 * Format a balance amount with decimals
 */
export function formatBalance(amount: string | bigint, decimals: number, maxDecimals = 6): string {
  try {
    const amountBigInt = typeof amount === 'string' ? BigInt(amount) : amount
    const divisor = BigInt(10 ** decimals)
    const integerPart = amountBigInt / divisor
    const fractionalPart = amountBigInt % divisor

    if (fractionalPart === 0n) {
      return integerPart.toString()
    }

    const fractionalStr = fractionalPart.toString().padStart(decimals, '0')
    const trimmed = fractionalStr.slice(0, maxDecimals).replace(/0+$/, '')

    return trimmed ? `${integerPart}.${trimmed}` : integerPart.toString()
  } catch {
    return '0'
  }
}

/**
 * Format a fiat value (USD, EUR, etc.)
 */
export function formatFiatValue(value: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

/**
 * Parse amount string to BigInt with decimals
 */
export function parseAmount(amount: string, decimals: number): bigint {
  if (!amount || amount === '0') return 0n

  const [integerPart, fractionalPart = ''] = amount.split('.')
  const paddedFractional = fractionalPart.padEnd(decimals, '0').slice(0, decimals)
  const combined = integerPart + paddedFractional

  return BigInt(combined)
}

/**
 * Native token ticker for a chain, read from the SDK's canonical
 * `chainFeeCoin` registry instead of a hand-rolled local map. Falls back to
 * the chain name itself for chains `chainFeeCoin` doesn't (yet) cover.
 */
export function getChainNativeTicker(chain: string): string {
  return chainFeeCoin[chain as Chain]?.ticker ?? chain
}

/**
 * Native token decimals for a chain, read from the SDK's canonical
 * `chainFeeCoin` registry instead of a hand-rolled local map. Falls back to
 * 18 (the most common EVM decimals) for chains `chainFeeCoin` doesn't (yet)
 * cover.
 */
export function getChainNativeDecimals(chain: string): number {
  return chainFeeCoin[chain as Chain]?.decimals ?? 18
}

/**
 * Returns true when `chain` is one of the SDK's canonical UTXO chains
 * (Bitcoin, Bitcoin-Cash, Litecoin, Dogecoin, Dash, Zcash).
 */
export function isUtxoChain(chain: string): boolean {
  return Object.values(Chain).includes(chain as Chain) && isChainOfKind(chain as Chain, 'utxo')
}

export type ParsedSelectedUtxos =
  | { ok: true; utxos: SelectedUtxoInput[]; totalAmount: bigint }
  | { ok: false; message: string }

/**
 * Parse newline-delimited `txid:vout:satoshis` candidate UTXOs entered in the
 * send form.
 */
export function parseSelectedUtxosInput(raw: string): ParsedSelectedUtxos {
  const lines = raw
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)

  if (lines.length === 0) {
    return {
      ok: false,
      message: 'Enter at least one UTXO in txid:vout:satoshis format.',
    }
  }

  const seen = new Set<string>()
  const utxos: SelectedUtxoInput[] = []
  let totalAmount = 0n

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1
    const segments = lines[i].split(':')
    if (segments.length !== 3) {
      return {
        ok: false,
        message: `Line ${lineNum}: expected txid:vout:satoshis.`,
      }
    }
    const [txidRaw, voutRaw, satsRaw] = segments
    if (!/^[0-9a-f]{64}$/i.test(txidRaw)) {
      return {
        ok: false,
        message: `Line ${lineNum}: txid must be 64 hex characters.`,
      }
    }
    if (!/^(0|[1-9]\d*)$/.test(voutRaw) || Number(voutRaw) > 0xffffffff) {
      return {
        ok: false,
        message: `Line ${lineNum}: vout must be a uint32 integer.`,
      }
    }
    if (!/^[1-9]\d*$/.test(satsRaw) || BigInt(satsRaw) > 0x7fffffffffffffffn) {
      return {
        ok: false,
        message: `Line ${lineNum}: satoshis must be a positive integer.`,
      }
    }

    const hash = txidRaw.toLowerCase()
    const index = Number(voutRaw)
    const outpoint = `${hash}:${index}`
    if (seen.has(outpoint)) {
      return {
        ok: false,
        message: `Line ${lineNum}: duplicate outpoint ${outpoint}.`,
      }
    }
    seen.add(outpoint)
    utxos.push({ hash, index, amount: satsRaw })
    totalAmount += BigInt(satsRaw)
  }

  return { ok: true, utxos, totalAmount }
}

/**
 * Get block explorer URL for a transaction
 */
export function getExplorerUrl(chain: Chain, txHash: string): string {
  const explorers: Record<string, string> = {
    Ethereum: `https://etherscan.io/tx/${txHash}`,
    Bitcoin: `https://blockstream.info/tx/${txHash}`,
    Avalanche: `https://snowtrace.io/tx/${txHash}`,
    BSC: `https://bscscan.com/tx/${txHash}`,
    Polygon: `https://polygonscan.com/tx/${txHash}`,
    // Add more chains as needed
  }

  return explorers[chain] || '#'
}

/**
 * Validate Ethereum address
 */
export function isValidEthereumAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address)
}

/**
 * Validate Bitcoin address
 */
export function isValidBitcoinAddress(address: string): boolean {
  return /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$|^bc1[a-z0-9]{39,59}$/.test(address)
}
