/**
 * Address validation for L1 chains and THORChain
 * @module validation/address-validator
 */

import { fromBech32 } from '@cosmjs/encoding'

import { RujiraError, RujiraErrorCode } from '../errors.js'

const evmValidator = (addr: string) => /^0x[a-fA-F0-9]{40}$/.test(addr)

const L1_ADDRESS_VALIDATORS: Record<string, (addr: string) => boolean> = {
  BTC: addr => /^(1|3)[a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(addr) || /^bc1[a-z0-9]{39,87}$/.test(addr),
  ETH: evmValidator,
  BSC: evmValidator,
  AVAX: evmValidator,
  BASE: evmValidator,
  ARB: evmValidator,
  GAIA: addr => /^cosmos1[a-z0-9]{38}$/.test(addr),
  NOBLE: addr => /^noble1[a-z0-9]{38}$/.test(addr),
  DOGE: addr => /^D[a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(addr),
  DASH: addr => /^[X7][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(addr),
  LTC: addr => /^[LM3][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(addr) || /^ltc1[a-z0-9]{39,87}$/.test(addr),
  BCH: addr =>
    /^(1|3)[a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(addr) ||
    /^bitcoincash:[qp][a-z0-9]{41}$/.test(addr) ||
    /^[qp][a-z0-9]{41}$/.test(addr),
  XRP: addr => /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(addr),
  TRON: addr => /^T[a-zA-Z0-9]{33}$/.test(addr),
  ZEC: addr => /^t1[a-km-zA-HJ-NP-Z1-9]{33}$/.test(addr) || /^t3[a-km-zA-HJ-NP-Z1-9]{33}$/.test(addr),
}

/**
 * Validate an L1 chain address.
 * Throws RujiraError if the address is invalid.
 */
export function validateL1Address(chain: string, address: string): void {
  if (!address || address.trim().length === 0) {
    throw new RujiraError(RujiraErrorCode.INVALID_ADDRESS, `${chain} address is required`)
  }

  const validator = L1_ADDRESS_VALIDATORS[chain.toUpperCase()]
  if (validator) {
    if (!validator(address)) {
      throw new RujiraError(RujiraErrorCode.INVALID_ADDRESS, `Invalid ${chain} address: ${address}`)
    }
  } else {
    // Fallback: non-empty, reasonable length
    if (address.length < 10 || address.length > 128) {
      throw new RujiraError(
        RujiraErrorCode.INVALID_ADDRESS,
        `Invalid ${chain} address: expected 10-128 characters, got ${address.length}`
      )
    }
  }
}

/**
 * Validate a THORChain bech32 address (thor1...).
 * Throws RujiraError if the address is invalid.
 */
export function validateThorAddress(address: string): void {
  if (!address || typeof address !== 'string') {
    throw new RujiraError(RujiraErrorCode.INVALID_ADDRESS, 'Destination address is required')
  }

  const trimmed = address.trim()

  if (!trimmed.startsWith('thor1')) {
    throw new RujiraError(
      RujiraErrorCode.INVALID_ADDRESS,
      `Invalid destination address format: must start with 'thor1'. Got: ${address.substring(0, 10)}...`
    )
  }

  try {
    const decoded = fromBech32(trimmed)

    if (decoded.prefix !== 'thor') {
      throw new RujiraError(
        RujiraErrorCode.INVALID_ADDRESS,
        `Invalid address prefix: expected 'thor', got '${decoded.prefix}'`
      )
    }

    if (decoded.data.length !== 20 && decoded.data.length !== 32) {
      throw new RujiraError(
        RujiraErrorCode.INVALID_ADDRESS,
        `Invalid address data length: expected 20 or 32 bytes, got ${decoded.data.length}`
      )
    }
  } catch (error) {
    if (error instanceof RujiraError) {
      throw error
    }

    throw new RujiraError(
      RujiraErrorCode.INVALID_ADDRESS,
      `Invalid bech32 address: ${error instanceof Error ? error.message : 'checksum verification failed'}`
    )
  }
}
