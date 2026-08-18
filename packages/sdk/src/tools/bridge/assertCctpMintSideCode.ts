/**
 * assertCctpMintSideHasCode — runtime fail-closed guard verifying the
 * destination chain's MessageTransmitter contract actually has code
 * deployed, before a CCTP burn tx is surfaced for signing.
 *
 * `packages/sdk/src/tools/bridge/cctp.ts`'s registry is already pinned
 * against Circle's published addresses via an oracle test in CI (fixing the
 * Base messageTransmitter codeless-EOA incident, sdk#1213/#1214) — but that
 * only catches drift that goes through CI. Nothing previously verified AT
 * RUNTIME that the mint-side contract still has code before the burn leg
 * executes. A registry drift, a wrong chain entry, or a Circle redeploy
 * would otherwise burn USDC on the source chain with no verified mint path
 * (burn-without-mint fund loss).
 *
 * Fail-closed only: a false negative (e.g. a flaky RPC) just blocks the
 * route temporarily with a clear error — this NEVER signs or broadcasts.
 * Positive results are cached per (chain, address) for the process
 * lifetime so repeat quotes on the same destination don't re-hit the RPC;
 * negatives are never cached, so a transient failure can't calcify into a
 * permanent block.
 */

import { getEvmClient } from '@vultisig/core-chain/chains/evm/client'

import { getCctpChain } from './cctp'

export class CctpMintSideCodeError extends Error {}

const verifiedMintSideAddresses = new Set<string>()

/**
 * Assert the destination chain's CCTP MessageTransmitter has deployed code.
 * Call this at route-build time, before surfacing the burn tx for signing.
 *
 * @throws {CctpMintSideCodeError} if the destination chain is unsupported,
 * or the MessageTransmitter address has no code (`0x`).
 */
export const assertCctpMintSideHasCode = async (destinationChain: string): Promise<void> => {
  const dstChainName = destinationChain.trim()
  const dstCctp = getCctpChain(dstChainName)
  if (!dstCctp) {
    throw new CctpMintSideCodeError(`destination chain ${JSON.stringify(dstChainName)} is not supported by CCTP`)
  }

  const address = dstCctp.messageTransmitter
  const cacheKey = `${dstCctp.chain}:${address.toLowerCase()}`
  if (verifiedMintSideAddresses.has(cacheKey)) return

  const client = getEvmClient(dstCctp.chain)
  const code = await client.getCode({ address })

  if (!code || code === '0x') {
    throw new CctpMintSideCodeError(
      `CCTP route unavailable: no contract code found at the ${dstChainName} MessageTransmitter (${address}). ` +
        'Refusing to build a burn transaction that would burn USDC on the source chain with no verified mint path.'
    )
  }

  verifiedMintSideAddresses.add(cacheKey)
}
