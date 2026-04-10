import { type Abi, encodeAbiParameters, encodeFunctionData, parseAbi, parseAbiParameters } from 'viem'

type AbiEncodeResult = `0x${string}`

/**
 * ABI-encode a Solidity function call from its human-readable signature and arguments.
 *
 * @example
 * ```ts
 * // Function call encoding (includes 4-byte selector)
 * abiEncode('function transfer(address,uint256)', ['0xabc...', '1000000'])
 *
 * // Raw parameter packing (no selector)
 * abiEncode('(address,uint256)', ['0xabc...', '1000000'])
 * ```
 */
export const abiEncode = (signature: string, args: readonly unknown[]): AbiEncodeResult => {
  const isFunctionCall = signature.startsWith('function ')

  if (isFunctionCall) {
    const abi = parseAbi([signature] as const)
    const functionName = signature.match(/function\s+(\w+)/)?.[1]
    if (!functionName) {
      throw new Error(`Could not parse function name from signature: ${signature}`)
    }
    return encodeFunctionData({ abi: abi as Abi, functionName, args })
  }

  // Raw parameter encoding (no selector prefix)
  const paramTypes = parseAbiParameters(signature)
  return encodeAbiParameters(paramTypes, args as readonly unknown[])
}
