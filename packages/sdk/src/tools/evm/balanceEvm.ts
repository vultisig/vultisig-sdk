import { EvmChain } from '@vultisig/core-chain/Chain'
import { getEvmClient } from '@vultisig/core-chain/chains/evm/client'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { decodeAbiParameters, erc20Abi, parseAbiParameters } from 'viem'

import { evmCall } from './evmCall'

/** Format a raw base-unit bigint to a human-readable decimal string (no precision loss). */
const formatUnits = (raw: bigint, decimals: number): string => {
  const divisor = 10n ** BigInt(decimals)
  const whole = raw / divisor
  const frac = raw % divisor
  if (frac === 0n) return whole.toString()
  return `${whole}.${frac.toString().padStart(decimals, '0').replace(/0+$/, '')}`
}

const SYMBOL_SELECTOR = '0x95d89b41' as const

/**
 * Decode a right-NULL-padded bytes32 string. Legacy ERC-20s (MKR, SAI class)
 * return `symbol()` as a raw bytes32 instead of the canonical ABI `string`,
 * which viem's typed `readContract` decoder rejects outright.
 */
const decodeBytes32Symbol = (data: `0x${string}`): string => {
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

/**
 * Read an ERC-20 `symbol()`, tolerating both the canonical ABI `string`
 * return and the legacy right-padded `bytes32` return (MKR / SAI class).
 * `readContract` decodes strictly against the ABI and throws for the bytes32
 * shape, so we go through a raw `eth_call` and try both decodings.
 */
const readSymbol = async (chain: EvmChain, address: `0x${string}`): Promise<string> => {
  const data = await evmCall(chain, { to: address, data: SYMBOL_SELECTOR })
  if (data === '0x') return 'UNKNOWN'
  try {
    const [symbol] = decodeAbiParameters(parseAbiParameters('string'), data)
    return symbol
  } catch {
    return decodeBytes32Symbol(data)
  }
}

export type EvmBalance = {
  /** ERC-20 contract address, or undefined for the native coin. */
  contractAddress?: `0x${string}`
  /** Token symbol (e.g. ETH, USDC). */
  symbol: string
  /** Token decimals. */
  decimals: number
  /** Raw on-chain balance in base units (wei / smallest unit). */
  raw: bigint
  /** Human-readable balance formatted with `decimals`. */
  balance: string
}

export type GetEvmBalancesParams = {
  /** Holder address (0x-prefixed). */
  address: `0x${string}`
  /**
   * ERC-20 contract addresses to read. The native coin is always included as
   * the first entry of the result; pass an empty array (or omit) for native-only.
   */
  tokens?: `0x${string}`[]
}

/**
 * Multi-token EVM balance read via RPC: native coin + any number of ERC-20s
 * in a single batched call. `getCoinBalance` covers the single-coin path;
 * this is the multi/RPC fan-out a portfolio view needs.
 *
 * Native symbol/decimals come from `chainFeeCoin`; ERC-20 symbol/decimals are
 * read on-chain (balanceOf + decimals + symbol) so unknown tokens resolve
 * without a registry.
 *
 * @example
 * ```ts
 * const balances = await getEvmBalances('Ethereum', {
 *   address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', // vitalik.eth
 *   tokens: ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'], // USDC
 * })
 * // => [
 * //   { symbol: 'ETH',  decimals: 18, raw: 1234n, balance: '0.000…' },
 * //   { symbol: 'USDC', decimals: 6,  raw: 500000n, balance: '0.5', contractAddress: '0xA0b8…' },
 * // ]
 * ```
 */
export const getEvmBalances = async (chain: EvmChain, params: GetEvmBalancesParams): Promise<EvmBalance[]> => {
  const client = getEvmClient(chain)
  const { address, tokens = [] } = params

  const nativeCoin = chainFeeCoin[chain]

  const [nativeRaw, ...tokenResults] = await Promise.all([
    client.getBalance({ address }),
    ...tokens.map(async (contractAddress): Promise<EvmBalance> => {
      const [raw, decimals, symbol] = await Promise.all([
        client.readContract({
          address: contractAddress,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [address],
        }),
        client.readContract({
          address: contractAddress,
          abi: erc20Abi,
          functionName: 'decimals',
        }),
        readSymbol(chain, contractAddress),
      ])

      return {
        contractAddress,
        symbol,
        decimals,
        raw,
        balance: formatUnits(raw, decimals),
      }
    }),
  ])

  const native: EvmBalance = {
    symbol: nativeCoin.ticker,
    decimals: nativeCoin.decimals,
    raw: nativeRaw,
    balance: formatUnits(nativeRaw, nativeCoin.decimals),
  }

  return [native, ...tokenResults]
}
