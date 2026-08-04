import { decodeFunctionData, parseAbi } from 'viem'

import { GeneralSwapProvider } from './GeneralSwapProvider'

type MinOutputProtectedProvider = Extract<GeneralSwapProvider, '1inch' | 'kyber' | 'li.fi'>

const protectedProviders: ReadonlySet<GeneralSwapProvider> = new Set(['1inch', 'kyber', 'li.fi'])

const oneInchRouterAbi = parseAbi([
  'function swap(address executor, (address srcToken, address dstToken, address srcReceiver, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 flags) desc, bytes data) payable returns (uint256 returnAmount, uint256 spentAmount)',
  'function swap(address executor, (address srcToken, address dstToken, address srcReceiver, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 flags) desc, bytes permit, bytes data) payable returns (uint256 returnAmount, uint256 spentAmount)',
  'function unoswap(uint256 token, uint256 amount, uint256 minReturn, uint256 dex) returns (uint256 returnAmount)',
  'function unoswap2(uint256 token, uint256 amount, uint256 minReturn, uint256 dex, uint256 dex2) returns (uint256 returnAmount)',
  'function unoswap3(uint256 token, uint256 amount, uint256 minReturn, uint256 dex, uint256 dex2, uint256 dex3) returns (uint256 returnAmount)',
  'function unoswapTo(uint256 recipient, uint256 token, uint256 amount, uint256 minReturn, uint256 dex) returns (uint256 returnAmount)',
  'function unoswapTo2(uint256 recipient, uint256 token, uint256 amount, uint256 minReturn, uint256 dex, uint256 dex2) returns (uint256 returnAmount)',
  'function unoswapTo3(uint256 recipient, uint256 token, uint256 amount, uint256 minReturn, uint256 dex, uint256 dex2, uint256 dex3) returns (uint256 returnAmount)',
  'function ethUnoswap(uint256 minReturn, uint256 dex) payable returns (uint256 returnAmount)',
  'function ethUnoswap2(uint256 minReturn, uint256 dex, uint256 dex2) payable returns (uint256 returnAmount)',
  'function ethUnoswap3(uint256 minReturn, uint256 dex, uint256 dex2, uint256 dex3) payable returns (uint256 returnAmount)',
  'function ethUnoswapTo(uint256 recipient, uint256 minReturn, uint256 dex) payable returns (uint256 returnAmount)',
  'function ethUnoswapTo2(uint256 recipient, uint256 minReturn, uint256 dex, uint256 dex2) payable returns (uint256 returnAmount)',
  'function ethUnoswapTo3(uint256 recipient, uint256 minReturn, uint256 dex, uint256 dex2, uint256 dex3) payable returns (uint256 returnAmount)',
  'function clipperSwap(address clipperExchange, uint256 srcToken, address dstToken, uint256 inputAmount, uint256 outputAmount, uint256 goodUntil, bytes32 r, bytes32 vs) payable returns (uint256 returnAmount)',
  'function clipperSwapTo(address clipperExchange, address recipient, uint256 srcToken, address dstToken, uint256 inputAmount, uint256 outputAmount, uint256 goodUntil, bytes32 r, bytes32 vs) payable returns (uint256 returnAmount)',
  'function clipperSwap(address clipperExchange, address srcToken, address dstToken, uint256 inputAmount, uint256 outputAmount, uint256 goodUntil, bytes32 r, bytes32 vs) payable returns (uint256 returnAmount)',
  'function clipperSwapTo(address clipperExchange, address recipient, address srcToken, address dstToken, uint256 inputAmount, uint256 outputAmount, uint256 goodUntil, bytes32 r, bytes32 vs) payable returns (uint256 returnAmount)',
  'function clipperSwapToWithPermit(address clipperExchange, address recipient, address srcToken, address dstToken, uint256 inputAmount, uint256 outputAmount, uint256 goodUntil, bytes32 r, bytes32 vs, bytes permit) payable returns (uint256 returnAmount)',
  'function uniswapV3Swap(uint256 amount, uint256 minReturn, uint256[] pools) payable returns (uint256 returnAmount)',
  'function uniswapV3SwapTo(address recipient, uint256 amount, uint256 minReturn, uint256[] pools) payable returns (uint256 returnAmount)',
  'function uniswapV3SwapToWithPermit(address recipient, address srcToken, uint256 amount, uint256 minReturn, uint256[] pools, bytes permit) payable returns (uint256 returnAmount)',
  'function unoswap(address srcToken, uint256 amount, uint256 minReturn, uint256[] pools) payable returns (uint256 returnAmount)',
  'function unoswapTo(address recipient, address srcToken, uint256 amount, uint256 minReturn, uint256[] pools) payable returns (uint256 returnAmount)',
  'function unoswapToWithPermit(address recipient, address srcToken, uint256 amount, uint256 minReturn, uint256[] pools, bytes permit) payable returns (uint256 returnAmount)',
])

const kyberRouterAbi = parseAbi([
  'function swap((address callTarget, address approveTarget, bytes targetData, (address srcToken, address dstToken, address[] srcReceivers, uint256[] srcAmounts, address[] feeReceivers, uint256[] feeAmounts, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 flags, bytes permit) desc, bytes clientData) execution) payable returns (uint256 returnAmount, uint256 gasUsed)',
  'function swapGeneric((address callTarget, address approveTarget, bytes targetData, (address srcToken, address dstToken, address[] srcReceivers, uint256[] srcAmounts, address[] feeReceivers, uint256[] feeAmounts, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 flags, bytes permit) desc, bytes clientData) execution) payable returns (uint256 returnAmount, uint256 gasUsed)',
  'function swapSimpleMode(address caller, (address srcToken, address dstToken, address[] srcReceivers, uint256[] srcAmounts, address[] feeReceivers, uint256[] feeAmounts, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 flags, bytes permit) desc, bytes executorData, bytes clientData) returns (uint256 returnAmount, uint256 gasUsed)',
])

const lifiGenericSwapAbi = parseAbi([
  'function swapTokensSingleV3ERC20ToERC20(bytes32 transactionId, string integrator, string referrer, address receiver, uint256 minAmountOut, (address callTo, address approveTo, address sendingAssetId, address receivingAssetId, uint256 fromAmount, bytes callData, bool requiresDeposit) swapData)',
  'function swapTokensSingleV3ERC20ToNative(bytes32 transactionId, string integrator, string referrer, address receiver, uint256 minAmountOut, (address callTo, address approveTo, address sendingAssetId, address receivingAssetId, uint256 fromAmount, bytes callData, bool requiresDeposit) swapData)',
  'function swapTokensSingleV3NativeToERC20(bytes32 transactionId, string integrator, string referrer, address receiver, uint256 minAmountOut, (address callTo, address approveTo, address sendingAssetId, address receivingAssetId, uint256 fromAmount, bytes callData, bool requiresDeposit) swapData) payable',
  'function swapTokensMultipleV3ERC20ToNative(bytes32 transactionId, string integrator, string referrer, address receiver, uint256 minAmountOut, (address callTo, address approveTo, address sendingAssetId, address receivingAssetId, uint256 fromAmount, bytes callData, bool requiresDeposit)[] swapData)',
  'function swapTokensMultipleV3ERC20ToERC20(bytes32 transactionId, string integrator, string referrer, address receiver, uint256 minAmountOut, (address callTo, address approveTo, address sendingAssetId, address receivingAssetId, uint256 fromAmount, bytes callData, bool requiresDeposit)[] swapData)',
  'function swapTokensMultipleV3NativeToERC20(bytes32 transactionId, string integrator, string referrer, address receiver, uint256 minAmountOut, (address callTo, address approveTo, address sendingAssetId, address receivingAssetId, uint256 fromAmount, bytes callData, bool requiresDeposit)[] swapData) payable',
])

const asArgs = (args: unknown): readonly unknown[] => args as readonly unknown[]

const asBigInt = (value: unknown): bigint => {
  if (typeof value !== 'bigint') {
    throw new Error('decoded minimum output is not an integer')
  }
  return value
}

const getNamedBigInt = (value: unknown, key: string): bigint =>
  asBigInt((value as Record<string, unknown> | undefined)?.[key])

const decodeOneInchMinOutput = (data: `0x${string}`): bigint => {
  const decoded = decodeFunctionData({ abi: oneInchRouterAbi, data })
  const args = asArgs(decoded.args)

  if (decoded.functionName === 'swap') return getNamedBigInt(args[1], 'minReturnAmount')
  if (/^unoswap(?:2|3)?$/.test(decoded.functionName)) return asBigInt(args[2])
  if (/^unoswapTo(?:2|3)?$/.test(decoded.functionName)) return asBigInt(args[3])
  if (/^ethUnoswap(?:2|3)?$/.test(decoded.functionName)) return asBigInt(args[0])
  if (/^ethUnoswapTo(?:2|3)?$/.test(decoded.functionName)) return asBigInt(args[1])
  if (decoded.functionName === 'clipperSwap') return asBigInt(args[4])
  if (decoded.functionName === 'clipperSwapTo' || decoded.functionName === 'clipperSwapToWithPermit') {
    return asBigInt(args[5])
  }
  if (decoded.functionName === 'uniswapV3Swap') return asBigInt(args[1])
  if (decoded.functionName === 'uniswapV3SwapTo' || decoded.functionName === 'uniswapV3SwapToWithPermit') {
    return asBigInt(args[decoded.functionName === 'uniswapV3SwapTo' ? 2 : 3])
  }
  if (decoded.functionName === 'unoswapToWithPermit') return asBigInt(args[3])

  throw new Error(`unsupported 1inch function ${decoded.functionName}`)
}

const decodeKyberMinOutput = (data: `0x${string}`): bigint => {
  const decoded = decodeFunctionData({ abi: kyberRouterAbi, data })
  const args = asArgs(decoded.args)
  const description = decoded.functionName === 'swapSimpleMode' ? args[1] : (args[0] as { desc?: unknown })?.desc
  return getNamedBigInt(description, 'minReturnAmount')
}

const decodeLifiMinOutput = (data: `0x${string}`): bigint => {
  const decoded = decodeFunctionData({ abi: lifiGenericSwapAbi, data })
  return asBigInt(asArgs(decoded.args)[4])
}

/**
 * Decodes the final-output floor enforced by the aggregator router calldata.
 * Unknown or cross-chain selectors fail closed: a floor from a source-chain
 * bridge deposit is not comparable to the quoted destination asset amount.
 */
export const decodeAggregatorCalldataMinOutput = ({
  provider,
  data,
}: {
  provider: MinOutputProtectedProvider
  data: string
}): bigint => {
  if (!/^0x[0-9a-fA-F]{8,}$/.test(data) || data.length % 2 !== 0) {
    throw new Error(`${provider} returned malformed EVM swap calldata`)
  }

  try {
    const hexData = data as `0x${string}`
    if (provider === '1inch') return decodeOneInchMinOutput(hexData)
    if (provider === 'kyber') return decodeKyberMinOutput(hexData)
    return decodeLifiMinOutput(hexData)
  } catch (error) {
    const selector = data.slice(0, 10)
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(
      `${provider} calldata selector ${selector} does not expose a sign-time-verifiable final minimum output; refusing to sign (${reason})`
    )
  }
}

const SLIPPAGE_PPM_PER_BPS = 100
const PPM_DENOMINATOR = 1_000_000n

/**
 * Binds the router-enforced minimum output to the quote amount and the exact
 * slippage tolerance used to request it. This runs immediately before the
 * general swap is converted into a keysign payload.
 */
export const assertAggregatorCalldataMinOutputBound = ({
  provider,
  data,
  quotedOutputAmount,
  maxSlippageBps,
}: {
  provider: GeneralSwapProvider
  data: string
  quotedOutputAmount: string
  maxSlippageBps: number | undefined
}): void => {
  if (!protectedProviders.has(provider)) return

  if (
    maxSlippageBps === undefined ||
    !Number.isFinite(maxSlippageBps) ||
    maxSlippageBps < 0 ||
    maxSlippageBps > 10_000
  ) {
    throw new Error(`${provider} swap quote has no valid slippage policy to bind at sign time`)
  }

  const slippagePpmNumber = maxSlippageBps * SLIPPAGE_PPM_PER_BPS
  if (!Number.isSafeInteger(slippagePpmNumber)) {
    throw new Error(`${provider} swap quote slippage has more precision than the sign-time policy supports`)
  }

  let expectedOutput: bigint
  try {
    expectedOutput = BigInt(quotedOutputAmount)
  } catch {
    throw new Error(`${provider} swap quote has an invalid destination amount (${quotedOutputAmount})`)
  }
  if (expectedOutput <= 0n) {
    throw new Error(`${provider} swap quote destination amount must be positive`)
  }

  const minimumOutput = decodeAggregatorCalldataMinOutput({
    provider: provider as MinOutputProtectedProvider,
    data,
  })
  const requiredMinimum = (expectedOutput * (PPM_DENOMINATOR - BigInt(slippagePpmNumber))) / PPM_DENOMINATOR

  if (minimumOutput <= 0n || minimumOutput < requiredMinimum) {
    throw new Error(
      `${provider} calldata minimum output (${minimumOutput}) is below the quote-bound floor (${requiredMinimum}) for expected output ${expectedOutput} and ${maxSlippageBps} bps slippage; refusing to sign`
    )
  }
}
