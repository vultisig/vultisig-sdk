import { decodeUniversalRouterExecute } from '@vultisig/core-chain/chains/evm/contract/universalRouter/decode'
import { decodeFunctionData, parseAbi, type Hex } from 'viem'

/**
 * Sell amount + optional deadline extracted from known EVM-general aggregator
 * calldata. `null` means the selector is not one of the shapes we can read
 * safely — callers MUST fail open rather than invent an amount.
 */
export type EvmGeneralSwapCommitment = {
  sellAmount: bigint
  deadlineSeconds?: number
}

// Exact-in Uniswap V2/V3 + THOR router + 1inch V5 `swap`. Exact-out variants
// are intentionally omitted: their first uint is amountOut / amountInMax, and
// treating that as the committed sell would either reject valid quotes or
// bless a larger spend than the user reviewed.
const KNOWN_SWAP_ABI = parseAbi([
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)',
  'function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline)',
  'function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)',
  'function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)',
  'function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline)',
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params)',
  'function exactInput((bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum) params)',
  'function depositWithExpiry(address vault, address asset, uint256 amount, string memo, uint256 expiry)',
  'function execute(bytes commands, bytes[] inputs, uint256 deadline)',
  'function swap(address executor, (address srcToken, address dstToken, address srcReceiver, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 flags) desc, bytes permit, bytes data)',
])

function asHex(data: string): Hex | null {
  if (!data) return null
  const hex = (data.startsWith('0x') ? data : `0x${data}`) as Hex
  return hex.length >= 10 ? hex : null
}

function parseValue(value: string | undefined): bigint | null {
  if (value === undefined || value === '') return null
  try {
    const parsed = BigInt(value)
    return parsed > 0n ? parsed : null
  } catch {
    return null
  }
}

/**
 * Decode a committed sell amount (and deadline, when the function carries one)
 * out of EVM-general swap calldata.
 *
 * Fail-open on unknown selectors: 1inch/Kyber/LI.FI wrap inner executors whose
 * ABI we do not fully enumerate. A wrong decode would either brick valid
 * swaps or give false confidence. Known exact-in shapes only.
 */
export function decodeEvmGeneralSwapCommitment(
  data: string,
  value?: string
): EvmGeneralSwapCommitment | null {
  const hex = asHex(data)
  if (!hex) {
    const native = parseValue(value)
    return native === null ? null : { sellAmount: native }
  }

  try {
    const decoded = decodeFunctionData({ abi: KNOWN_SWAP_ABI, data: hex })
    switch (decoded.functionName) {
      case 'swapExactTokensForTokens':
      case 'swapExactTokensForETH':
      case 'swapExactTokensForTokensSupportingFeeOnTransferTokens': {
        const [amountIn, , , , deadline] = decoded.args
        return { sellAmount: amountIn, deadlineSeconds: Number(deadline) }
      }
      case 'swapExactETHForTokens':
      case 'swapExactETHForTokensSupportingFeeOnTransferTokens': {
        const [, , , deadline] = decoded.args
        const native = parseValue(value)
        if (native === null) return null
        return { sellAmount: native, deadlineSeconds: Number(deadline) }
      }
      case 'exactInputSingle': {
        const params = decoded.args[0]
        return { sellAmount: params.amountIn, deadlineSeconds: Number(params.deadline) }
      }
      case 'exactInput': {
        const params = decoded.args[0]
        return { sellAmount: params.amountIn, deadlineSeconds: Number(params.deadline) }
      }
      case 'depositWithExpiry': {
        const [, , amount, , expiry] = decoded.args
        return { sellAmount: amount, deadlineSeconds: Number(expiry) }
      }
      case 'execute': {
        const deadline = decoded.args[2]
        const intent = decodeUniversalRouterExecute(hex)
        if (!intent) return null
        return { sellAmount: intent.amountIn, deadlineSeconds: Number(deadline) }
      }
      case 'swap': {
        return { sellAmount: decoded.args[1].amount }
      }
      default:
        return null
    }
  } catch {
    // Two-arg Universal Router `execute(bytes,bytes[])` has no deadline in the
    // outer ABI; the existing decoder still recovers amountIn.
    const intent = decodeUniversalRouterExecute(hex)
    if (intent) return { sellAmount: intent.amountIn }
    return null
  }
}
