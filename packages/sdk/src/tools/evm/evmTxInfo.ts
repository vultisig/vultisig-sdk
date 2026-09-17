import { EvmChain } from '@vultisig/core-chain/Chain'
import { getEvmClient } from '@vultisig/core-chain/chains/evm/client'

type EvmTxInfoParams = {
  address: `0x${string}`
  to?: `0x${string}`
  data?: `0x${string}`
  value?: bigint
}

type EvmTxInfoResult = {
  nonce: number
  baseFeePerGas: bigint
  maxPriorityFeePerGas: bigint
  suggestedMaxFeePerGas: bigint
  chainId: number
  estimatedGas?: bigint
}

/**
 * Get the next nonce for `address`. Prefers the `'pending'` block tag so an
 * external wallet's not-yet-confirmed transaction (e.g. MetaMask) is counted
 * too — `'latest'` alone only reflects confirmed txs and can hand out an
 * already-used nonce. Falls back to `'latest'` for chains that don't support
 * `'pending'` explicitly. Transport, rate-limit, and server failures propagate
 * rather than falling back to a potentially occupied confirmed nonce.
 */
const rejectsPendingTag = (error: unknown): boolean => {
  const seen = new Set<object>()
  let current = error
  while (typeof current === 'object' && current !== null && !seen.has(current)) {
    seen.add(current)
    const record = current as { message?: unknown; details?: unknown; cause?: unknown }
    for (const value of [record.message, record.details]) {
      if (typeof value !== 'string') continue
      if (/(?:pending.{0,40}(?:unsupported|not supported|not implemented|invalid)|(?:unsupported|not supported|not implemented|invalid).{0,40}pending)/i.test(value)) return true
    }
    current = record.cause
  }
  return false
}

const getEvmTxInfoNonce = async (client: ReturnType<typeof getEvmClient>, address: `0x${string}`): Promise<number> => {
  try {
    return await client.getTransactionCount({ address, blockTag: 'pending' })
  } catch (error) {
    if (!rejectsPendingTag(error)) throw error
    return client.getTransactionCount({ address, blockTag: 'latest' })
  }
}

/**
 * Get nonce, gas prices, and chain ID for building an EVM transaction.
 * Optionally estimates gas if `to`/`data`/`value` are provided.
 *
 * @example
 * ```ts
 * const info = await evmTxInfo('Ethereum', {
 *   address: '0xabc...',
 * })
 * // => { nonce: 42, baseFeePerGas: 30000000000n, ... }
 * ```
 */
export const evmTxInfo = async (chain: EvmChain, params: EvmTxInfoParams): Promise<EvmTxInfoResult> => {
  const client = getEvmClient(chain)

  const [nonce, block, maxPriorityFeePerGas, chainId] = await Promise.all([
    getEvmTxInfoNonce(client, params.address),
    client.getBlock(),
    client.estimateMaxPriorityFeePerGas(),
    client.getChainId(),
  ])

  const baseFeePerGas = block.baseFeePerGas ?? 0n
  const suggestedMaxFeePerGas = baseFeePerGas * 2n + maxPriorityFeePerGas

  const result: EvmTxInfoResult = {
    nonce,
    baseFeePerGas,
    maxPriorityFeePerGas,
    suggestedMaxFeePerGas,
    chainId,
  }

  if (params.to) {
    result.estimatedGas = await client.estimateGas({
      account: params.address,
      to: params.to,
      data: params.data,
      value: params.value,
    })
  }

  return result
}
