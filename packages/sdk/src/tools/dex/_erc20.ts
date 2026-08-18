/**
 * Shared ERC-20 read helpers for the on-chain DEX quote tools.
 *
 * Ported from mcp-ts `src/tools/uniswap/_erc20.ts` so the SDK owns the
 * decode/read primitive instead of duplicating it in every consumer. Pure
 * read-only: every call funnels through the SDK's `evmCall` (eth_call).
 */
import { EvmChain } from '@vultisig/core-chain/Chain'
import { decodeAbiParameters, parseAbiParameters } from 'viem'

// Import from the concrete module, not the `../evm` barrel: the barrel re-exports
// balanceEvm.ts (getEvmBalances), which imports readSymbol from this very file to
// decode bytes32-returning ERC-20 symbols (sdk#1946) — importing the barrel here
// would close that cycle (flagged by dependency-cruiser's no-circular rule).
import { evmCall } from '../evm/evmCall'

const SEL_SYMBOL = '0x95d89b41' as const
const SEL_DECIMALS = '0x313ce567' as const

/**
 * Max ERC-20 decimals accepted by DEX quote readers. Although decimals() is a
 * uint8, downstream fixed-point math raises 10 to a decimals-derived exponent.
 * Bounding the value prevents attacker-controlled tokens from forcing
 * pathologically large bigint allocations while retaining ample headroom for
 * real tokens.
 */
const MAX_ERC20_DECIMALS = 36

/**
 * Decode a right-NULL-padded bytes32 string. Some non-standard ERC-20s
 * (MKR, SAI) return a bytes32 instead of a string for symbol().
 */
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
  const decimals = BigInt(data)
  if (decimals > BigInt(MAX_ERC20_DECIMALS)) {
    throw new Error(
      `token ${token} reported implausible decimals ${decimals} (> ${MAX_ERC20_DECIMALS}); refusing to compute prices.`
    )
  }
  return Number(decimals)
}

export function decodeAddress(data: `0x${string}`): `0x${string}` {
  const [addr] = decodeAbiParameters(parseAbiParameters('address'), data)
  return addr
}
