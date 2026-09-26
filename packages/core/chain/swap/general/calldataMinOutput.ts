import { decodeFunctionData, parseAbi, toFunctionSelector } from 'viem'

import { evmNativeCoinAddress } from '../../chains/evm/config'
import { GeneralSwapProvider } from './GeneralSwapProvider'

type MinOutputProtectedProvider = Extract<GeneralSwapProvider, '1inch' | 'kyber' | 'li.fi'>

/** Convert the exact API slippage unit to an integer basis-point policy. */
export const toMaxSlippageBps = (slippage: number, bpsPerUnit: number): number => {
  const rawBps = slippage * bpsPerUnit
  const bps = Math.round(rawBps)
  // Tolerate only binary floating-point representation noise, never a fractional basis point.
  if (
    !Number.isFinite(rawBps) ||
    Math.abs(rawBps - bps) > Number.EPSILON * Math.max(1, Math.abs(rawBps)) * 4 ||
    bps < 0 ||
    bps > 10_000
  ) {
    throw new Error('EVM aggregator slippage must be representable as 0..10000 integer basis points')
  }
  return bps
}

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

type DecodedOutput =
  | {
      kind: 'asset-bound'
      minimum: bigint
      asset: string
      receiver: string | undefined
      zeroReceiverIsSender?: boolean
    }
  | { kind: 'recipient-bound'; minimum: bigint; receiver: string | undefined }

const getNamedAddress = (value: unknown, key: string): string => {
  const address = (value as Record<string, unknown> | undefined)?.[key]
  if (typeof address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error(`decoded ${key} is not an EVM address`)
  }
  return address
}

const getPackedOrAddressRecipient = (value: unknown): string => {
  if (typeof value === 'string') return getNamedAddress({ recipient: value }, 'recipient')
  // 1inch's uint256 `to` puts the beneficiary in the low 160 bits.
  if (typeof value === 'bigint') return `0x${(value & ((1n << 160n) - 1n)).toString(16).padStart(40, '0')}`
  throw new Error('decoded recipient is not an EVM address')
}

const rejectPartialFill = (description: unknown): void => {
  // With bit 0 set, the router checks minReturnAmount pro rata against the
  // input actually spent, not as an absolute floor for the quoted output.
  if ((getNamedBigInt(description, 'flags') & 1n) !== 0n) {
    throw new Error('partial-fill calldata has no absolute minimum output; refusing to sign')
  }
}

const decodeOneInchMinOutput = (data: `0x${string}`): DecodedOutput => {
  const decoded = decodeFunctionData({ abi: oneInchRouterAbi, data })
  const args = asArgs(decoded.args)

  if (decoded.functionName === 'swap') {
    rejectPartialFill(args[1])
    return {
      kind: 'asset-bound',
      minimum: getNamedBigInt(args[1], 'minReturnAmount'),
      asset: getNamedAddress(args[1], 'dstToken'),
      receiver: getNamedAddress(args[1], 'dstReceiver'),
      // AggregationRouter swap resolves a zero dstReceiver to msg.sender.
      zeroReceiverIsSender: true,
    }
  }
  if (decoded.functionName === 'clipperSwap') {
    return {
      kind: 'asset-bound',
      minimum: asBigInt(args[4]),
      asset: getNamedAddress({ dstToken: args[2] }, 'dstToken'),
      receiver: undefined,
    }
  }
  if (decoded.functionName === 'clipperSwapTo' || decoded.functionName === 'clipperSwapToWithPermit') {
    return {
      kind: 'asset-bound',
      minimum: asBigInt(args[5]),
      asset: getNamedAddress({ dstToken: args[3] }, 'dstToken'),
      receiver: getNamedAddress({ recipient: args[1] }, 'recipient'),
    }
  }
  // Packed pool data conceals the final asset. Bind an exposed `to` beneficiary
  // while keeping the destination asset explicitly unverified.
  if (/^unoswap(?:2|3)?$/.test(decoded.functionName))
    return { kind: 'recipient-bound', minimum: asBigInt(args[2]), receiver: undefined }
  if (/^unoswapTo(?:2|3)?$/.test(decoded.functionName)) {
    return {
      kind: 'recipient-bound',
      minimum: asBigInt(args[3]),
      receiver: getPackedOrAddressRecipient(args[0]),
    }
  }
  if (/^ethUnoswap(?:2|3)?$/.test(decoded.functionName))
    return { kind: 'recipient-bound', minimum: asBigInt(args[0]), receiver: undefined }
  if (/^ethUnoswapTo(?:2|3)?$/.test(decoded.functionName)) {
    return {
      kind: 'recipient-bound',
      minimum: asBigInt(args[1]),
      receiver: getPackedOrAddressRecipient(args[0]),
    }
  }
  if (decoded.functionName === 'uniswapV3Swap')
    return { kind: 'recipient-bound', minimum: asBigInt(args[1]), receiver: undefined }
  if (decoded.functionName === 'uniswapV3SwapTo' || decoded.functionName === 'uniswapV3SwapToWithPermit') {
    return {
      kind: 'recipient-bound',
      minimum: asBigInt(args[decoded.functionName === 'uniswapV3SwapTo' ? 2 : 3]),
      receiver: getPackedOrAddressRecipient(args[0]),
    }
  }
  if (decoded.functionName === 'unoswapToWithPermit') {
    return {
      kind: 'recipient-bound',
      minimum: asBigInt(args[3]),
      receiver: getPackedOrAddressRecipient(args[0]),
    }
  }
  throw new Error(`unsupported 1inch function ${decoded.functionName}`)
}

const decodeKyberMinOutput = (data: `0x${string}`): DecodedOutput => {
  const decoded = decodeFunctionData({ abi: kyberRouterAbi, data })
  const args = asArgs(decoded.args)
  const description = decoded.functionName === 'swapSimpleMode' ? args[1] : (args[0] as { desc?: unknown })?.desc
  rejectPartialFill(description)
  return {
    kind: 'asset-bound',
    minimum: getNamedBigInt(description, 'minReturnAmount'),
    asset: getNamedAddress(description, 'dstToken'),
    receiver: getNamedAddress(description, 'dstReceiver'),
    // MetaAggregationRouterV2 resolves a zero dstReceiver to msg.sender.
    zeroReceiverIsSender: true,
  }
}

const decodeLifiMinOutput = (data: `0x${string}`): DecodedOutput => {
  const decoded = decodeFunctionData({ abi: lifiGenericSwapAbi, data })
  const args = asArgs(decoded.args)
  const swapData = args[5]
  const finalSwap = Array.isArray(swapData) ? swapData.at(-1) : swapData
  if (!finalSwap) throw new Error('LI.FI same-chain swap has no final output asset')
  return {
    kind: 'asset-bound',
    minimum: asBigInt(args[4]),
    asset: getNamedAddress(finalSwap, 'receivingAssetId'),
    receiver: getNamedAddress({ receiver: args[3] }, 'receiver'),
  }
}

const knownSelectors = {
  '1inch': new Set(oneInchRouterAbi.map(item => toFunctionSelector(item).toLowerCase())),
  kyber: new Set(kyberRouterAbi.map(item => toFunctionSelector(item).toLowerCase())),
  'li.fi': new Set(lifiGenericSwapAbi.map(item => toFunctionSelector(item).toLowerCase())),
}

/** Returns undefined when the selector has no comparable final-output floor.
 * These routes remain available and retain the aggregator as their trust boundary.
 */
const decodeAggregatorCalldataOutput = ({
  provider,
  data,
}: {
  provider: MinOutputProtectedProvider
  data: string
}): DecodedOutput | undefined => {
  if (!/^0x[0-9a-fA-F]{8,}$/.test(data) || data.length % 2 !== 0) {
    throw new Error(`${provider} returned malformed EVM swap calldata`)
  }

  const selector = data.slice(0, 10).toLowerCase()
  if (!knownSelectors[provider].has(selector)) return undefined

  try {
    const hexData = data as `0x${string}`
    if (provider === '1inch') return decodeOneInchMinOutput(hexData)
    if (provider === 'kyber') return decodeKyberMinOutput(hexData)
    return decodeLifiMinOutput(hexData)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`${provider} recognized calldata selector ${selector} is malformed; refusing to sign (${reason})`)
  }
}

/** A decoded numeric minimum does not by itself prove output-asset or receiver
 * binding; the sign-time assertion checks every exposed field. */
export const decodeAggregatorCalldataMinOutput = (input: {
  provider: MinOutputProtectedProvider
  data: string
}): bigint | undefined => decodeAggregatorCalldataOutput(input)?.minimum

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
  destinationAsset,
  intendedRecipient,
  senderAddress,
}: {
  provider: GeneralSwapProvider
  data: string
  quotedOutputAmount: string
  maxSlippageBps: number | undefined
  destinationAsset?: string
  intendedRecipient?: string
  senderAddress?: string
}): void => {
  if (!protectedProviders.has(provider)) return

  if (
    maxSlippageBps === undefined ||
    !Number.isInteger(maxSlippageBps) ||
    maxSlippageBps < 0 ||
    maxSlippageBps > 10_000
  ) {
    throw new Error(`${provider} swap quote has no valid slippage policy to bind at sign time`)
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

  const decodedOutput = decodeAggregatorCalldataOutput({
    provider: provider as MinOutputProtectedProvider,
    data,
  })
  if (decodedOutput === undefined) return

  const minimumOutput = decodedOutput.minimum
  const requiredMinimum = (expectedOutput * (10_000n - BigInt(maxSlippageBps))) / 10_000n
  if (minimumOutput <= 0n || minimumOutput < requiredMinimum) {
    throw new Error(
      `${provider} calldata minimum output (${minimumOutput}) is below the quote-bound floor (${requiredMinimum}) for expected output ${expectedOutput} and ${maxSlippageBps} bps slippage; refusing to sign`
    )
  }
  if (decodedOutput.kind === 'asset-bound') {
    const expectedAsset = destinationAsset ?? evmNativeCoinAddress
    const isNative = (address: string) =>
      address.toLowerCase() === evmNativeCoinAddress ||
      address.toLowerCase() === '0x0000000000000000000000000000000000000000'
    const assetMatches =
      (isNative(expectedAsset) && isNative(decodedOutput.asset)) ||
      decodedOutput.asset.toLowerCase() === expectedAsset.toLowerCase()
    if (!/^0x[0-9a-fA-F]{40}$/.test(expectedAsset) || !assetMatches) {
      throw new Error(`${provider} calldata destination asset does not match the quoted output asset; refusing to sign`)
    }
  }
  const receiver =
    decodedOutput.kind === 'asset-bound' &&
    decodedOutput.receiver === '0x0000000000000000000000000000000000000000' &&
    decodedOutput.zeroReceiverIsSender
      ? senderAddress
      : (decodedOutput.receiver ?? senderAddress)
  if (
    !receiver ||
    !intendedRecipient ||
    !/^0x[0-9a-fA-F]{40}$/.test(intendedRecipient) ||
    receiver.toLowerCase() !== intendedRecipient.toLowerCase()
  ) {
    throw new Error(`${provider} calldata output receiver does not match the intended recipient; refusing to sign`)
  }
}
