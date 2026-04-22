/**
 * EVM transaction encoding primitives (RN-safe).
 *
 * Vendored from vultiagent-app/src/services/evmTx.ts but rebuilt on viem's
 * `serializeTransaction` so that the same logic runs unchanged on Node,
 * Browser, Electron, and Hermes/RN. Viem is a peer dependency (externalised
 * in rollup.platforms.config.js) so this module adds no standalone viem copy
 * to the SDK bundle — consumers that already install viem share the module.
 *
 * All 13 EVM chains declared in `@vultisig/core-chain/Chain` are supported:
 *   Ethereum, Avalanche, BSC, Polygon, Arbitrum, Optimism, Base, Blast,
 *   Zksync, Mantle, Hyperliquid, Sei, CronosChain.
 *
 * The surface mirrors the Cosmos RN bridge:
 *   - `buildEvmSendTx(opts)`        → native-token send
 *   - `buildErc20TransferTx(opts)`  → ERC20 transfer calldata + tx
 *   - `buildErc20ApproveTx(opts)`   → ERC20 approve calldata + tx
 *   - `buildEvmContractCallTx(opts)`→ arbitrary contract write
 *   - `encodeErc20Transfer(...)`    → just the calldata hex
 *   - `encodeErc20Approve(...)`     → just the calldata hex
 *
 * Each builder returns `{ signingHashHex, unsignedRawHex, finalize(sigHex) }`
 * — the consumer passes `signingHashHex` to `fastVaultSign`/`keysign`, then
 * calls `finalize(sigHex)` to produce the broadcastable `rawTxHex`.
 *
 * The builder picks legacy vs EIP-1559 automatically:
 *   - if `gasPrice` is passed → legacy
 *   - if `maxFeePerGas`/`maxPriorityFeePerGas` are passed → EIP-1559 (type 2)
 *   - if neither → EIP-1559 (caller must supply fees separately)
 *
 * RPC helpers live in `./rpc.ts` and accept an explicit `rpcUrl` so consumers
 * keep full control over endpoint selection.
 */

import { EvmChain } from '@vultisig/core-chain/Chain'
import { encodeFunctionData, erc20Abi, keccak256, serializeTransaction } from 'viem'

// ---------------------------------------------------------------------------
// Tx fee format — mirrors packages/core/chain/chains/evm/tx/fee/index.ts
// ---------------------------------------------------------------------------

const evmChainIds: Record<EvmChain, number> = {
  Ethereum: 1,
  Avalanche: 43114,
  BSC: 56,
  Polygon: 137,
  Arbitrum: 42161,
  Optimism: 10,
  Base: 8453,
  Blast: 81457,
  Zksync: 324,
  Mantle: 5000,
  Hyperliquid: 999,
  Sei: 1329,
  CronosChain: 25,
}

export const getEvmChainId = (chain: EvmChain): number => evmChainIds[chain]

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EvmTxBuilderResult = {
  /** keccak-256 of the serialized (unsigned) tx — pass to fastVaultSign/keysign */
  signingHashHex: string
  /** Unsigned serialized tx bytes, hex-prefixed (for record-keeping/debugging) */
  unsignedRawHex: `0x${string}`
  /**
   * Given the hex-encoded raw signature (r||s||recoveryId, 65 bytes =
   * 130 hex chars), return the broadcastable signed tx hex.
   *
   * For EIP-1559 tx, `v` is the raw recoveryId (0 or 1).
   * For legacy tx, `v = recoveryId + chainId*2 + 35` (EIP-155).
   */
  finalize: (sigHex: string) => { rawTxHex: `0x${string}`; txHashHex: `0x${string}` }
}

type FeeFields =
  | {
      /** EIP-1559 maxFeePerGas in wei */
      maxFeePerGas: bigint
      /** EIP-1559 maxPriorityFeePerGas in wei */
      maxPriorityFeePerGas: bigint
      gasPrice?: never
    }
  | {
      /** Legacy gas price in wei */
      gasPrice: bigint
      maxFeePerGas?: never
      maxPriorityFeePerGas?: never
    }

export type BuildEvmSendOptions = {
  chain: EvmChain
  fromAddress: `0x${string}`
  toAddress: `0x${string}`
  valueWei: bigint
  nonce: number
  gasLimit: bigint
  /** Optional override for the on-chain chainId (defaults to `getEvmChainId(chain)`). */
  chainId?: number
} & FeeFields

export type BuildEvmContractCallOptions = {
  chain: EvmChain
  fromAddress: `0x${string}`
  toAddress: `0x${string}`
  /** Hex-prefixed calldata */
  data: `0x${string}`
  /** Native value sent with the call — defaults to 0n */
  valueWei?: bigint
  nonce: number
  gasLimit: bigint
  chainId?: number
} & FeeFields

export type BuildErc20TransferOptions = Omit<BuildEvmContractCallOptions, 'toAddress' | 'data' | 'valueWei'> & {
  /** ERC-20 contract address */
  tokenAddress: `0x${string}`
  /** Recipient address */
  recipient: `0x${string}`
  /** Amount in token base units */
  amount: bigint
}

export type BuildErc20ApproveOptions = Omit<BuildEvmContractCallOptions, 'toAddress' | 'data' | 'valueWei'> & {
  tokenAddress: `0x${string}`
  spender: `0x${string}`
  /** Approval amount in token base units */
  amount: bigint
}

// ---------------------------------------------------------------------------
// Calldata encoders — pure, useful standalone
// ---------------------------------------------------------------------------

export const encodeErc20Transfer = (recipient: `0x${string}`, amount: bigint): `0x${string}` =>
  encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [recipient, amount] })

export const encodeErc20Approve = (spender: `0x${string}`, amount: bigint): `0x${string}` =>
  encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [spender, amount] })

// ---------------------------------------------------------------------------
// Tx builders
// ---------------------------------------------------------------------------

/**
 * Build a native-token EVM send transaction.
 *
 * @example
 * ```ts
 * const tx = buildEvmSendTx({
 *   chain: 'Ethereum',
 *   fromAddress: '0xabc...',
 *   toAddress: '0xdef...',
 *   valueWei: 10n ** 16n, // 0.01 ETH
 *   nonce: 42,
 *   gasLimit: 21000n,
 *   maxFeePerGas: 30n * 10n ** 9n,
 *   maxPriorityFeePerGas: 1n * 10n ** 9n,
 * })
 * const sigHex = await fastVaultSign(keyshare, tx.signingHashHex, ...)
 * const { rawTxHex } = tx.finalize(sigHex)
 * await broadcastEvmRawTx(rpcUrl, rawTxHex)
 * ```
 */
export function buildEvmSendTx(opts: BuildEvmSendOptions): EvmTxBuilderResult {
  return buildEvmContractCallTx({
    ...opts,
    toAddress: opts.toAddress,
    data: '0x',
    valueWei: opts.valueWei,
  } as BuildEvmContractCallOptions)
}

/**
 * Build an arbitrary EVM contract-call transaction.
 *
 * This is the most general builder — every other `build*` function delegates
 * to it after encoding the appropriate calldata.
 */
export function buildEvmContractCallTx(opts: BuildEvmContractCallOptions): EvmTxBuilderResult {
  const chainId = opts.chainId ?? getEvmChainId(opts.chain)
  const value = opts.valueWei ?? 0n
  const isLegacy = opts.gasPrice !== undefined

  // Viem's `serializeTransaction` chooses the tx type from the fee fields:
  //   - `gasPrice` → 'legacy'
  //   - `maxFeePerGas` + `maxPriorityFeePerGas` → 'eip1559'
  const unsignedRawHex = isLegacy
    ? serializeTransaction({
        type: 'legacy',
        chainId,
        nonce: opts.nonce,
        gasPrice: opts.gasPrice!,
        gas: opts.gasLimit,
        to: opts.toAddress,
        value,
        data: opts.data,
      })
    : serializeTransaction({
        type: 'eip1559',
        chainId,
        nonce: opts.nonce,
        maxFeePerGas: opts.maxFeePerGas!,
        maxPriorityFeePerGas: opts.maxPriorityFeePerGas!,
        gas: opts.gasLimit,
        to: opts.toAddress,
        value,
        data: opts.data,
      })

  const signingHashHex = keccak256(unsignedRawHex)

  const finalize = (sigHex: string): { rawTxHex: `0x${string}`; txHashHex: `0x${string}` } => {
    const clean = sigHex.startsWith('0x') ? sigHex.slice(2) : sigHex
    if (clean.length !== 130) {
      throw new Error(`expected 65-byte signature (130 hex chars, r||s||recoveryId), got ${clean.length}`)
    }
    const r = `0x${clean.substring(0, 64)}` as `0x${string}`
    const s = `0x${clean.substring(64, 128)}` as `0x${string}`
    const recoveryId = parseInt(clean.substring(128, 130), 16)

    const rawTxHex = isLegacy
      ? serializeTransaction(
          {
            type: 'legacy',
            chainId,
            nonce: opts.nonce,
            gasPrice: opts.gasPrice!,
            gas: opts.gasLimit,
            to: opts.toAddress,
            value,
            data: opts.data,
          },
          {
            r,
            s,
            // EIP-155: v = recoveryId + chainId*2 + 35. Viem stores this raw
            // in the final RLP for legacy txs — pass it pre-computed.
            v: BigInt(recoveryId + chainId * 2 + 35),
          }
        )
      : serializeTransaction(
          {
            type: 'eip1559',
            chainId,
            nonce: opts.nonce,
            maxFeePerGas: opts.maxFeePerGas!,
            maxPriorityFeePerGas: opts.maxPriorityFeePerGas!,
            gas: opts.gasLimit,
            to: opts.toAddress,
            value,
            data: opts.data,
          },
          {
            r,
            s,
            yParity: recoveryId as 0 | 1,
          }
        )

    const txHashHex = keccak256(rawTxHex)
    return { rawTxHex, txHashHex }
  }

  return { signingHashHex, unsignedRawHex, finalize }
}

export function buildErc20TransferTx(opts: BuildErc20TransferOptions): EvmTxBuilderResult {
  return buildEvmContractCallTx({
    chain: opts.chain,
    fromAddress: opts.fromAddress,
    toAddress: opts.tokenAddress,
    data: encodeErc20Transfer(opts.recipient, opts.amount),
    valueWei: 0n,
    nonce: opts.nonce,
    gasLimit: opts.gasLimit,
    chainId: opts.chainId,
    ...(opts.gasPrice !== undefined
      ? { gasPrice: opts.gasPrice }
      : { maxFeePerGas: opts.maxFeePerGas!, maxPriorityFeePerGas: opts.maxPriorityFeePerGas! }),
  } as BuildEvmContractCallOptions)
}

export function buildErc20ApproveTx(opts: BuildErc20ApproveOptions): EvmTxBuilderResult {
  return buildEvmContractCallTx({
    chain: opts.chain,
    fromAddress: opts.fromAddress,
    toAddress: opts.tokenAddress,
    data: encodeErc20Approve(opts.spender, opts.amount),
    valueWei: 0n,
    nonce: opts.nonce,
    gasLimit: opts.gasLimit,
    chainId: opts.chainId,
    ...(opts.gasPrice !== undefined
      ? { gasPrice: opts.gasPrice }
      : { maxFeePerGas: opts.maxFeePerGas!, maxPriorityFeePerGas: opts.maxPriorityFeePerGas! }),
  } as BuildEvmContractCallOptions)
}
