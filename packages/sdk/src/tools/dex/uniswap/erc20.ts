/**
 * Minimal read-only ERC-20 helpers for the Uniswap pool-info primitive.
 * Thin wrappers around the SDK's `evmCall` (eth_call). RPC errors propagate.
 *
 * Ported from vultisig/mcp-ts `src/tools/uniswap/_erc20.ts`.
 */
import { decodeAbiParameters, parseAbiParameters } from 'viem'

import type { EvmChain } from '../../../types'
import { evmCall } from '../../evm'

const SEL_SYMBOL = '0x95d89b41' as const
const SEL_DECIMALS = '0x313ce567' as const

/** Decode a right-NULL-padded bytes32 string (MKR/SAI-style symbols). */
export function decodeBytes32String(data: `0x${string}`): string {
  const hex = data.slice(2)
  let end = hex.length
  while (end >= 2 && hex.slice(end - 2, end) === '00') end -= 2
  if (end === 0) return 'UNKNOWN'
  let out = ''
  for (let i = 0; i < end; i += 2) {
    out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16))
  }
  return out
}

export async function readSymbol(chain: EvmChain, token: `0x${string}`): Promise<string> {
  const data = await evmCall(chain, { to: token, data: SEL_SYMBOL })
  if (!data || data === '0x') return 'UNKNOWN'
  // Some non-standard tokens (MKR, SAI) return a bytes32 instead of a string.
  try {
    const [s] = decodeAbiParameters(parseAbiParameters('string'), data)
    return s
  } catch {
    return decodeBytes32String(data)
  }
}

export async function readDecimals(chain: EvmChain, token: `0x${string}`): Promise<number> {
  const data = await evmCall(chain, { to: token, data: SEL_DECIMALS })
  if (!data || data === '0x') {
    throw new Error(`failed to read decimals for ${token}: empty response`)
  }
  return Number(BigInt(data))
}

export function decodeAddress(data: `0x${string}`): `0x${string}` {
  const [addr] = decodeAbiParameters(parseAbiParameters('address'), data)
  return addr
}
