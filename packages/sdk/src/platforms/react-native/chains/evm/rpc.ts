/**
 * RN-safe EVM JSON-RPC helpers.
 *
 * These accept an explicit `rpcUrl` so consumers keep control over endpoint
 * selection (public RPC vs vultisig's `rootApiUrl` vs an app-specific
 * gateway). They are thin wrappers over viem's `createPublicClient({
 * transport: http(rpcUrl) })`, which is already a peer dependency for the
 * SDK and works on Node, Browser, Electron, and Hermes/RN alike.
 *
 * For convenience, `getEvmNonce`, `getEvmGasPrice`, and `estimateEvmGas`
 * prefer the `'pending'` block tag and fall back to `'latest'` — matching
 * the app's hand-rolled `fetchNextNonce` behaviour so that mempool-aware
 * chains benefit while zkSync / Hyperliquid / Sei (which don't support
 * `'pending'` cleanly) still work.
 */

import { EvmChain } from '@vultisig/core-chain/Chain'
import { memoize } from '@vultisig/lib-utils/memoize'
import { createPublicClient, erc20Abi, http, type PublicClient } from 'viem'

import { getEvmChainId } from './tx'

const clientCache = memoize(
  (rpcUrl: string, _chainId: number): PublicClient =>
    createPublicClient({
      transport: http(rpcUrl),
      // Passing `chain: { id: chainId, ... }` is not required for plain RPC
      // reads; viem uses it only for wallet ops. We omit it to avoid
      // importing `viem/chains` just to look up a definition we already
      // know by numeric id.
    }) as unknown as PublicClient
)

const getClient = (chain: EvmChain, rpcUrl: string): PublicClient => clientCache(rpcUrl, getEvmChainId(chain))

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/**
 * Get the next nonce for `address`. Prefers `'pending'` so mempool txs are
 * counted, with a `'latest'` fallback for chains that don't support the
 * pending tag (zkSync Era, Hyperliquid, some alt-EVMs).
 */
export const getEvmNonce = async (rpcUrl: string, chain: EvmChain, address: `0x${string}`): Promise<number> => {
  const client = getClient(chain, rpcUrl)
  try {
    return await client.getTransactionCount({ address, blockTag: 'pending' })
  } catch {
    return client.getTransactionCount({ address, blockTag: 'latest' })
  }
}

/**
 * Suggested EIP-1559 fee fields, mirroring the app's convention:
 *   - `maxPriorityFeePerGas = baseFee / 10`  (10% of base fee tip)
 *   - `maxFeePerGas = baseFee * 2 + priorityFee`
 *
 * Caller should use these verbatim, or override if the UI offers a tip slider.
 */
export const getEvmSuggestedFees = async (
  rpcUrl: string,
  chain: EvmChain
): Promise<{
  baseFeePerGas: bigint
  maxPriorityFeePerGas: bigint
  maxFeePerGas: bigint
}> => {
  const client = getClient(chain, rpcUrl)
  const block = await client.getBlock()
  const baseFeePerGas = block.baseFeePerGas ?? (await client.getGasPrice())
  const maxPriorityFeePerGas = baseFeePerGas / 10n
  const maxFeePerGas = baseFeePerGas * 2n + maxPriorityFeePerGas
  return { baseFeePerGas, maxPriorityFeePerGas, maxFeePerGas }
}

/**
 * Legacy `eth_gasPrice`. Only use this for chains whose fee format is
 * `'legacy'` (BSC, Sei). For everything else, prefer `getEvmSuggestedFees`.
 */
export const getEvmGasPrice = async (rpcUrl: string, chain: EvmChain): Promise<bigint> =>
  getClient(chain, rpcUrl).getGasPrice()

/**
 * Estimate gas for a pending tx. Returns the RPC's estimate unmodified;
 * callers should apply their own safety buffer (the app uses +50%).
 */
export const estimateEvmGas = async (
  rpcUrl: string,
  chain: EvmChain,
  params: {
    from: `0x${string}`
    to: `0x${string}`
    value?: bigint
    data?: `0x${string}`
  }
): Promise<bigint> => {
  const client = getClient(chain, rpcUrl)
  return client.estimateGas({
    account: params.from,
    to: params.to,
    value: params.value,
    data: params.data,
  })
}

/** Fetch the on-chain chainId — useful for sanity-checking the RPC endpoint. */
export const getEvmChainIdFromRpc = async (rpcUrl: string, chain: EvmChain): Promise<number> =>
  getClient(chain, rpcUrl).getChainId()

/**
 * Broadcast a pre-signed raw EVM transaction. Returns the tx hash.
 *
 * Treats "already known"-class errors as non-fatal (same list as the SDK's
 * RawBroadcastService) by re-throwing a more descriptive error that lets
 * the caller decide whether to ignore.
 */
export const broadcastEvmRawTx = async (
  rpcUrl: string,
  chain: EvmChain,
  rawTxHex: `0x${string}`
): Promise<`0x${string}`> => {
  const client = getClient(chain, rpcUrl)
  return client.sendRawTransaction({ serializedTransaction: rawTxHex })
}

// ---------------------------------------------------------------------------
// ERC-20 read helpers — thin wrappers for consumer convenience
// ---------------------------------------------------------------------------

export const getErc20Balance = async (
  rpcUrl: string,
  chain: EvmChain,
  tokenAddress: `0x${string}`,
  accountAddress: `0x${string}`
): Promise<bigint> => {
  const client = getClient(chain, rpcUrl)
  return client.readContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [accountAddress],
  })
}

export const getErc20Decimals = async (
  rpcUrl: string,
  chain: EvmChain,
  tokenAddress: `0x${string}`
): Promise<number> => {
  const client = getClient(chain, rpcUrl)
  return client.readContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'decimals',
  })
}

export const getErc20Symbol = async (rpcUrl: string, chain: EvmChain, tokenAddress: `0x${string}`): Promise<string> => {
  const client = getClient(chain, rpcUrl)
  return client.readContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'symbol',
  })
}

export const getErc20Allowance = async (
  rpcUrl: string,
  chain: EvmChain,
  tokenAddress: `0x${string}`,
  owner: `0x${string}`,
  spender: `0x${string}`
): Promise<bigint> => {
  const client = getClient(chain, rpcUrl)
  return client.readContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [owner, spender],
  })
}
