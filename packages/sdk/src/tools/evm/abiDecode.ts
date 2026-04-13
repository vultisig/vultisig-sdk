import { type Abi, decodeAbiParameters, decodeFunctionData, parseAbi, parseAbiParameters } from 'viem'

type AbiDecodeResult = readonly unknown[]

/**
 * ABI-decode calldata or packed parameters from their human-readable signature.
 *
 * @example
 * ```ts
 * // Decode function calldata (with 4-byte selector)
 * abiDecode('function transfer(address,uint256)', '0xa9059cbb000...')
 * // => { functionName: 'transfer', args: ['0xabc...', 1000000n] }
 *
 * // Decode raw packed parameters (no selector)
 * abiDecode('(address,uint256)', '0x000...')
 * // => ['0xabc...', 1000000n]
 * ```
 */
export function abiDecode(
  signature: string,
  data: `0x${string}`
): { functionName: string; args: AbiDecodeResult } | AbiDecodeResult {
  const isFunctionCall = signature.startsWith('function ')

  if (isFunctionCall) {
    const abi = parseAbi([signature] as const)
    const { functionName, args } = decodeFunctionData({ abi: abi as Abi, data })
    return { functionName, args: args ?? [] }
  }

  // Raw parameter decoding
  const paramTypes = parseAbiParameters(signature)
  return decodeAbiParameters(paramTypes, data)
}
