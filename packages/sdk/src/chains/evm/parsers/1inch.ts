/**
 * 1inch aggregator transaction parser
 *
 * Handles parsing of 1inch swap transactions:
 * - swap()
 * - unoswap()
 * - unoswapTo()
 * - And other 1inch aggregator functions
 */

import { DEX_ROUTERS } from '../config'

export interface OneInchSwapParams {
  srcToken: string
  dstToken: string
  amount: bigint
  minReturn: bigint
  to?: string
}

/**
 * 1inch transaction parser utility class
 */
export class OneInchParser {
  // 1inch V5 function selectors
  static readonly SWAP = '0x12aa3caf'
  static readonly UNOSWAP = '0x0502b1c5'
  static readonly UNOSWAP_TO = '0xf78dc253'
  static readonly UNOSWAP_2 = '0xe449022e'
  static readonly UNISWAP_V3_SWAP = '0xe449022e'
  static readonly CLIP_SWAP = '0x9994dd15'

  /**
   * Check if transaction is a 1inch swap
   */
  static is1inchTransaction(to: string, data?: string): boolean {
    const toLower = to.toLowerCase()

    // Check if recipient is a known 1inch router
    const is1inchRouter =
      toLower === DEX_ROUTERS.ONEINCH_V5_ROUTER.toLowerCase() ||
      toLower === DEX_ROUTERS.ONEINCH_V6_ROUTER.toLowerCase()

    if (!is1inchRouter) {
      return false
    }

    if (!data || data.length < 10) {
      return false
    }

    const selector = data.slice(0, 10).toLowerCase()
    return (
      selector === this.SWAP ||
      selector === this.UNOSWAP ||
      selector === this.UNOSWAP_TO ||
      selector === this.UNOSWAP_2 ||
      selector === this.UNISWAP_V3_SWAP ||
      selector === this.CLIP_SWAP
    )
  }

  /**
   * Parse 1inch swap transaction
   * Note: 1inch uses complex encoding with multiple swap paths and protocols.
   * This is a simplified parser that extracts basic swap information.
   */
  static parseSwap(data: string): OneInchSwapParams {
    const selector = data.slice(0, 10).toLowerCase()

    if (selector === this.SWAP) {
      return this.parseStandardSwap(data)
    } else if (selector === this.UNOSWAP || selector === this.UNOSWAP_2) {
      return this.parseUnoswap(data)
    } else if (selector === this.UNOSWAP_TO) {
      return this.parseUnoswapTo(data)
    }

    throw new Error('Unsupported 1inch function')
  }

  /**
   * Parse standard 1inch swap()
   * swap(address executor, SwapDescription desc, bytes permit, bytes data)
   *
   * SwapDescription struct:
   * - srcToken: address
   * - dstToken: address
   * - srcReceiver: address
   * - dstReceiver: address
   * - amount: uint256
   * - minReturnAmount: uint256
   * - flags: uint256
   */
  private static parseStandardSwap(data: string): OneInchSwapParams {
    // The SwapDescription struct starts at offset 0x20 (after executor address)
    // Each parameter is 32 bytes

    let offset = 10 + 64 * 2 // Skip selector and executor, point to struct offset

    // Get the actual offset to the struct
    const structOffset = parseInt(data.slice(offset, offset + 64), 16) * 2 + 10

    let structPos = structOffset

    const srcToken = `0x${data.slice(structPos + 24, structPos + 64)}`
    structPos += 64

    const dstToken = `0x${data.slice(structPos + 24, structPos + 64)}`
    structPos += 64

    // Skip srcReceiver
    structPos += 64

    const dstReceiver = `0x${data.slice(structPos + 24, structPos + 64)}`
    structPos += 64

    const amount = BigInt(`0x${data.slice(structPos, structPos + 64)}`)
    structPos += 64

    const minReturn = BigInt(`0x${data.slice(structPos, structPos + 64)}`)

    return {
      srcToken,
      dstToken,
      amount,
      minReturn,
      to: dstReceiver,
    }
  }

  /**
   * Parse 1inch unoswap()
   * unoswap(address srcToken, uint256 amount, uint256 minReturn, uint256[] pools)
   *
   * This is a simplified version that works for single-hop swaps.
   * For multi-hop swaps, the destination token needs to be extracted from pool data.
   */
  private static parseUnoswap(data: string): OneInchSwapParams {
    let offset = 10 // Skip selector

    const srcToken = `0x${data.slice(offset + 24, offset + 64)}`
    offset += 64

    const amount = BigInt(`0x${data.slice(offset, offset + 64)}`)
    offset += 64

    const minReturn = BigInt(`0x${data.slice(offset, offset + 64)}`)
    offset += 64

    // Pools parameter is complex, for now we'll extract basic info
    // The destination token would be encoded in the pool data

    return {
      srcToken,
      dstToken: '0x0000000000000000000000000000000000000000', // Placeholder
      amount,
      minReturn,
    }
  }

  /**
   * Parse 1inch unoswapTo()
   * unoswapTo(address recipient, address srcToken, uint256 amount, uint256 minReturn, uint256[] pools)
   */
  private static parseUnoswapTo(data: string): OneInchSwapParams {
    let offset = 10 // Skip selector

    const to = `0x${data.slice(offset + 24, offset + 64)}`
    offset += 64

    const srcToken = `0x${data.slice(offset + 24, offset + 64)}`
    offset += 64

    const amount = BigInt(`0x${data.slice(offset, offset + 64)}`)
    offset += 64

    const minReturn = BigInt(`0x${data.slice(offset, offset + 64)}`)

    return {
      srcToken,
      dstToken: '0x0000000000000000000000000000000000000000', // Placeholder
      amount,
      minReturn,
      to,
    }
  }

  /**
   * Extract swap details from 1inch transaction
   */
  static getSwapDetails(data: string): {
    inputToken: string
    outputToken: string
    inputAmount: bigint
    minOutputAmount: bigint
    recipient?: string
  } {
    const swap = this.parseSwap(data)

    return {
      inputToken: swap.srcToken,
      outputToken: swap.dstToken,
      inputAmount: swap.amount,
      minOutputAmount: swap.minReturn,
      recipient: swap.to,
    }
  }

  /**
   * Get 1inch router version from address
   */
  static getRouterVersion(address: string): 'v5' | 'v6' | 'unknown' {
    const addressLower = address.toLowerCase()
    if (addressLower === DEX_ROUTERS.ONEINCH_V5_ROUTER.toLowerCase()) {
      return 'v5'
    }
    if (addressLower === DEX_ROUTERS.ONEINCH_V6_ROUTER.toLowerCase()) {
      return 'v6'
    }
    return 'unknown'
  }
}
