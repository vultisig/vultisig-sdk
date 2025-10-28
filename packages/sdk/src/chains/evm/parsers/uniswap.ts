/**
 * Uniswap V2/V3 transaction parser
 *
 * Handles parsing of Uniswap swap transactions:
 * - Uniswap V2: swapExactTokensForTokens, swapTokensForExactTokens
 * - Uniswap V3: exactInputSingle, exactInput, exactOutputSingle, exactOutput
 */

import { DEX_ROUTERS } from '../config'

export interface UniswapV2SwapParams {
  amountIn: bigint
  amountOutMin: bigint
  path: string[]
  to: string
  deadline: number
}

export interface UniswapV3ExactInputSingleParams {
  tokenIn: string
  tokenOut: string
  fee: number
  recipient: string
  deadline: number
  amountIn: bigint
  amountOutMinimum: bigint
  sqrtPriceLimitX96: bigint
}

export interface UniswapV3ExactInputParams {
  path: string
  recipient: string
  deadline: number
  amountIn: bigint
  amountOutMinimum: bigint
}

/**
 * Uniswap transaction parser utility class
 */
export class UniswapParser {
  // Uniswap V2 function selectors
  static readonly SWAP_EXACT_TOKENS_FOR_TOKENS = '0x38ed1739'
  static readonly SWAP_TOKENS_FOR_EXACT_TOKENS = '0x8803dbee'
  static readonly SWAP_EXACT_ETH_FOR_TOKENS = '0x7ff36ab5'
  static readonly SWAP_TOKENS_FOR_EXACT_ETH = '0x4a25d94a'
  static readonly SWAP_EXACT_TOKENS_FOR_ETH = '0x18cbafe5'
  static readonly SWAP_ETH_FOR_EXACT_TOKENS = '0xfb3bdb41'

  // Uniswap V3 function selectors
  static readonly EXACT_INPUT_SINGLE = '0x414bf389'
  static readonly EXACT_INPUT = '0xc04b8d59'
  static readonly EXACT_OUTPUT_SINGLE = '0xdb3e2198'
  static readonly EXACT_OUTPUT = '0xf28c0498'

  /**
   * Check if transaction is a Uniswap operation
   */
  static isUniswapTransaction(to: string, data: string): boolean {
    const toLower = to.toLowerCase()

    // Check if recipient is a known Uniswap router
    const isUniswapRouter =
      toLower === DEX_ROUTERS.UNISWAP_V2_ROUTER.toLowerCase() ||
      toLower === DEX_ROUTERS.UNISWAP_V3_ROUTER.toLowerCase() ||
      toLower === DEX_ROUTERS.UNISWAP_V3_ROUTER_2.toLowerCase()

    if (!isUniswapRouter) {
      return false
    }

    const selector = data.slice(0, 10).toLowerCase()
    return (
      selector === this.SWAP_EXACT_TOKENS_FOR_TOKENS ||
      selector === this.SWAP_TOKENS_FOR_EXACT_TOKENS ||
      selector === this.SWAP_EXACT_ETH_FOR_TOKENS ||
      selector === this.SWAP_TOKENS_FOR_EXACT_ETH ||
      selector === this.SWAP_EXACT_TOKENS_FOR_ETH ||
      selector === this.SWAP_ETH_FOR_EXACT_TOKENS ||
      selector === this.EXACT_INPUT_SINGLE ||
      selector === this.EXACT_INPUT ||
      selector === this.EXACT_OUTPUT_SINGLE ||
      selector === this.EXACT_OUTPUT
    )
  }

  /**
   * Check if transaction is Uniswap V2
   */
  static isV2(data: string): boolean {
    const selector = data.slice(0, 10).toLowerCase()
    return (
      selector === this.SWAP_EXACT_TOKENS_FOR_TOKENS ||
      selector === this.SWAP_TOKENS_FOR_EXACT_TOKENS ||
      selector === this.SWAP_EXACT_ETH_FOR_TOKENS ||
      selector === this.SWAP_TOKENS_FOR_EXACT_ETH ||
      selector === this.SWAP_EXACT_TOKENS_FOR_ETH ||
      selector === this.SWAP_ETH_FOR_EXACT_TOKENS
    )
  }

  /**
   * Check if transaction is Uniswap V3
   */
  static isV3(data: string): boolean {
    const selector = data.slice(0, 10).toLowerCase()
    return (
      selector === this.EXACT_INPUT_SINGLE ||
      selector === this.EXACT_INPUT ||
      selector === this.EXACT_OUTPUT_SINGLE ||
      selector === this.EXACT_OUTPUT
    )
  }

  /**
   * Parse Uniswap V2 swapExactTokensForTokens
   * swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline)
   */
  static parseSwapExactTokensForTokens(data: string): UniswapV2SwapParams {
    if (data.slice(0, 10).toLowerCase() !== this.SWAP_EXACT_TOKENS_FOR_TOKENS) {
      throw new Error('Not a swapExactTokensForTokens transaction')
    }

    // Decode parameters
    const amountIn = BigInt(`0x${data.slice(10, 74)}`)
    const amountOutMin = BigInt(`0x${data.slice(74, 138)}`)

    // Path offset and recipient
    const pathOffset = parseInt(data.slice(138, 202), 16) * 2 + 10
    const to = `0x${data.slice(202, 266).slice(24)}`
    const deadline = parseInt(data.slice(266, 330), 16)

    // Parse path array
    const pathLength = parseInt(data.slice(pathOffset, pathOffset + 64), 16)
    const path: string[] = []

    for (let i = 0; i < pathLength; i++) {
      const offset = pathOffset + 64 + i * 64
      const address = `0x${data.slice(offset, offset + 64).slice(24)}`
      path.push(address)
    }

    return {
      amountIn,
      amountOutMin,
      path,
      to,
      deadline,
    }
  }

  /**
   * Parse Uniswap V3 exactInputSingle
   * exactInputSingle(ExactInputSingleParams)
   */
  static parseExactInputSingle(data: string): UniswapV3ExactInputSingleParams {
    if (data.slice(0, 10).toLowerCase() !== this.EXACT_INPUT_SINGLE) {
      throw new Error('Not an exactInputSingle transaction')
    }

    // The struct is at offset 0x20 (32 bytes)
    // Struct: tokenIn, tokenOut, fee, recipient, deadline, amountIn, amountOutMinimum, sqrtPriceLimitX96
    let offset = 10 + 64 // Skip selector and first offset pointer

    const tokenIn = `0x${data.slice(offset + 24, offset + 64)}`
    offset += 64

    const tokenOut = `0x${data.slice(offset + 24, offset + 64)}`
    offset += 64

    const fee = parseInt(data.slice(offset, offset + 64), 16)
    offset += 64

    const recipient = `0x${data.slice(offset + 24, offset + 64)}`
    offset += 64

    const deadline = parseInt(data.slice(offset, offset + 64), 16)
    offset += 64

    const amountIn = BigInt(`0x${data.slice(offset, offset + 64)}`)
    offset += 64

    const amountOutMinimum = BigInt(`0x${data.slice(offset, offset + 64)}`)
    offset += 64

    const sqrtPriceLimitX96 = BigInt(`0x${data.slice(offset, offset + 64)}`)

    return {
      tokenIn,
      tokenOut,
      fee,
      recipient,
      deadline,
      amountIn,
      amountOutMinimum,
      sqrtPriceLimitX96,
    }
  }

  /**
   * Parse Uniswap V3 exactInput
   * exactInput(ExactInputParams)
   */
  static parseExactInput(data: string): UniswapV3ExactInputParams {
    if (data.slice(0, 10).toLowerCase() !== this.EXACT_INPUT) {
      throw new Error('Not an exactInput transaction')
    }

    // The struct is at offset 0x20 (32 bytes)
    // Struct: path, recipient, deadline, amountIn, amountOutMinimum
    let offset = 10 + 64 // Skip selector and first offset pointer

    // Path is encoded as bytes, get its offset
    const pathOffset = parseInt(data.slice(offset, offset + 64), 16) * 2 + 10
    offset += 64

    const recipient = `0x${data.slice(offset + 24, offset + 64)}`
    offset += 64

    const deadline = parseInt(data.slice(offset, offset + 64), 16)
    offset += 64

    const amountIn = BigInt(`0x${data.slice(offset, offset + 64)}`)
    offset += 64

    const amountOutMinimum = BigInt(`0x${data.slice(offset, offset + 64)}`)

    // Parse path (encoded as bytes)
    const pathLength = parseInt(data.slice(pathOffset, pathOffset + 64), 16)
    const pathData = data.slice(pathOffset + 64, pathOffset + 64 + pathLength * 2)

    return {
      path: `0x${pathData}`,
      recipient,
      deadline,
      amountIn,
      amountOutMinimum,
    }
  }

  /**
   * Parse any Uniswap swap transaction
   * Automatically detects version and function
   */
  static parseSwap(
    data: string
  ):
    | UniswapV2SwapParams
    | UniswapV3ExactInputSingleParams
    | UniswapV3ExactInputParams {
    const selector = data.slice(0, 10).toLowerCase()

    if (selector === this.SWAP_EXACT_TOKENS_FOR_TOKENS) {
      return this.parseSwapExactTokensForTokens(data)
    }
    if (selector === this.EXACT_INPUT_SINGLE) {
      return this.parseExactInputSingle(data)
    }
    if (selector === this.EXACT_INPUT) {
      return this.parseExactInput(data)
    }

    throw new Error('Unsupported Uniswap function')
  }

  /**
   * Extract tokens from parsed swap
   */
  static getTokensFromSwap(
    swap:
      | UniswapV2SwapParams
      | UniswapV3ExactInputSingleParams
      | UniswapV3ExactInputParams
  ): {
    inputToken: string
    outputToken: string
    inputAmount: bigint
    minOutputAmount: bigint
  } {
    if ('path' in swap && Array.isArray(swap.path)) {
      // V2 swap
      return {
        inputToken: swap.path[0],
        outputToken: swap.path[swap.path.length - 1],
        inputAmount: swap.amountIn,
        minOutputAmount: swap.amountOutMin,
      }
    } else if ('tokenIn' in swap) {
      // V3 exactInputSingle
      return {
        inputToken: swap.tokenIn,
        outputToken: swap.tokenOut,
        inputAmount: swap.amountIn,
        minOutputAmount: swap.amountOutMinimum,
      }
    } else {
      // V3 exactInput
      throw new Error('V3 exactInput path decoding not yet fully implemented')
    }
  }
}
