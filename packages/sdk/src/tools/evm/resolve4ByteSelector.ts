import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

type FourByteResult = {
  count: number
  results: { text_signature: string }[]
}

/**
 * Resolve a 4-byte function selector to human-readable function signatures
 * using the 4byte.directory API.
 *
 * @example
 * ```ts
 * const sigs = await resolve4ByteSelector('0xa9059cbb')
 * // => ['transfer(address,uint256)']
 * ```
 */
export const resolve4ByteSelector = async (selector: string): Promise<string[]> => {
  const hex = selector.startsWith('0x') ? selector : `0x${selector}`

  const response = await queryUrl<FourByteResult>(
    `https://www.4byte.directory/api/v1/signatures/?format=json&hex_signature=${hex}&ordering=created_at`
  )

  if (!response || typeof response === 'string') {
    return []
  }

  return response.results.map(r => r.text_signature)
}
