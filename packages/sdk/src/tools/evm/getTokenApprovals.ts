import { EvmChain } from '@vultisig/core-chain/Chain'
import { getEvmClient } from '@vultisig/core-chain/chains/evm/client'
import { erc20Abi, getAddress, isAddress, keccak256, pad, toHex } from 'viem'

/**
 * Threshold for "unlimited" allowance. Wallets/protocols commonly approve
 * MaxUint256 (2^256-1) but a common cheaper sentinel is 2^128. We treat any
 * allowance >= 2^128 as unlimited — matches revoke.cash behaviour.
 */
const UNLIMITED_THRESHOLD = 2n ** 128n

/** Max (token, spender) pairs returned to keep the result bounded. */
const MAX_PAIRS = 50

/** Block look-back when an "earliest" full-history scan is rejected by the RPC. */
const FALLBACK_BLOCK_RANGE = 10_000n

/** ERC-20 Approval(address indexed owner, address indexed spender, uint256 value) */
const APPROVAL_TOPIC = keccak256(toHex('Approval(address,address,uint256)'))

/** Minimal shape of an eth_getLogs entry we rely on. */
type ApprovalLog = {
  address: string
  topics: string[]
}

export type TokenApproval = {
  /** Checksummed ERC-20 token contract address. */
  tokenAddress: `0x${string}`
  /** Token symbol if it could be read on-chain, otherwise null. */
  tokenSymbol: string | null
  /** Checksummed spender (the contract approved to move the owner's tokens). */
  spenderAddress: `0x${string}`
  /** Current allowance as a raw base-unit bigint. */
  allowance: bigint
  /** `true` when the allowance is effectively unlimited (>= 2^128). */
  isUnlimited: boolean
}

export type GetTokenApprovalsResult = {
  /** Checksummed owner address the approvals belong to. */
  address: `0x${string}`
  chain: EvmChain
  approvals: TokenApproval[]
  totalCount: number
}

/**
 * Fetch `Approval` logs for `owner` via a raw `eth_getLogs` topic filter
 * (topic[0] = Approval sig, topic[1] = indexed owner). Tries a full-history
 * "earliest" scan, then falls back to a bounded recent window if the RPC
 * rejects the unbounded range. Using the raw RPC request (rather than viem's
 * typed `getLogs`) keeps the filter shape explicit and provider-agnostic.
 */
const fetchApprovalLogs = async (
  client: ReturnType<typeof getEvmClient>,
  owner: `0x${string}`
): Promise<ApprovalLog[]> => {
  const ownerTopic = pad(owner, { size: 32 })
  const topics = [APPROVAL_TOPIC, ownerTopic]

  try {
    return await client.request({
      method: 'eth_getLogs',
      params: [{ fromBlock: 'earliest', toBlock: 'latest', topics }],
    } as never)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Some RPCs reject an unbounded "earliest" scan. Retry over a bounded
    // recent window so we still surface the most relevant approvals.
    const boundedScanRejected =
      msg.includes('block range') ||
      msg.includes('too large') ||
      msg.includes('exceeds') ||
      msg.includes('limit') ||
      msg.includes('maximum') ||
      msg.includes('range')

    if (!boundedScanRejected) throw err

    const latest = await client.getBlockNumber()
    const fromBlock = latest > FALLBACK_BLOCK_RANGE ? latest - FALLBACK_BLOCK_RANGE : 0n
    return client.request({
      method: 'eth_getLogs',
      params: [{ fromBlock: toHex(fromBlock), toBlock: 'latest', topics }],
    } as never)
  }
}

/** Read the CURRENT on-chain allowance for a (token, spender) pair. 0n on revert. */
const readAllowance = async (
  client: ReturnType<typeof getEvmClient>,
  token: `0x${string}`,
  owner: `0x${string}`,
  spender: `0x${string}`
): Promise<bigint> => {
  try {
    const value = await client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [owner, spender],
    })
    return typeof value === 'bigint' ? value : 0n
  } catch {
    return 0n
  }
}

/** Read the token symbol. null on revert (non-standard tokens). */
const readSymbol = async (client: ReturnType<typeof getEvmClient>, token: `0x${string}`): Promise<string | null> => {
  try {
    const value = await client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'symbol',
    })
    return typeof value === 'string' && value.length > 0 ? value : null
  } catch {
    return null
  }
}

/**
 * Enumerate active ERC-20 approvals for an owner address on a single EVM chain.
 *
 * Strategy (mirrors revoke.cash):
 *   1. Fetch all `Approval(owner, spender, value)` events where indexed owner == address.
 *   2. De-duplicate to unique (token, spender) pairs.
 *   3. For each pair read `allowance(owner, spender)` to get the CURRENT value.
 *   4. Filter to pairs where the current allowance > 0n (revoked/spent ones drop out).
 *   5. Read `symbol()` for each surviving token.
 *
 * READ-ONLY: this builds no transaction and signs nothing. Use it to audit
 * spender exposure before revoking via an `approve(spender, 0)` calldata builder.
 *
 * @example
 * ```ts
 * const { approvals } = await getTokenApprovals('Ethereum', {
 *   owner: '0x28c6c06298d514db089934071355e5743bf21d60',
 * })
 * approvals.forEach((a) => {
 *   console.log(a.tokenSymbol, a.spenderAddress, a.isUnlimited ? 'unlimited' : a.allowance)
 * })
 * ```
 */
export const getTokenApprovals = async (
  chain: EvmChain,
  params: { owner: string }
): Promise<GetTokenApprovalsResult> => {
  if (!isAddress(params.owner, { strict: false })) {
    throw new Error(`getTokenApprovals: invalid owner address: ${params.owner}`)
  }
  const owner = getAddress(params.owner)
  const client = getEvmClient(chain)

  const logs = await fetchApprovalLogs(client, owner)

  // De-duplicate (token, spender) pairs. Over-fetch a little so that pairs which
  // turn out to be zero-allowance don't starve us below MAX_PAIRS active ones.
  const seen = new Set<string>()
  const pairs: Array<{ token: `0x${string}`; spender: `0x${string}` }> = []

  for (const log of logs) {
    // topics[1] = indexed owner, topics[2] = indexed spender (last 20 bytes).
    const spenderTopic = log.topics?.[2]
    const tokenRaw = log.address
    if (!spenderTopic) continue
    const spenderRaw = `0x${spenderTopic.slice(-40)}`
    if (!isAddress(spenderRaw, { strict: false })) continue
    if (!tokenRaw || !isAddress(tokenRaw, { strict: false })) continue

    const token = getAddress(tokenRaw)
    const spender = getAddress(spenderRaw)
    const key = `${token}:${spender}`
    if (seen.has(key)) continue

    seen.add(key)
    pairs.push({ token, spender })
    if (pairs.length >= MAX_PAIRS * 2) break
  }

  if (pairs.length === 0) {
    return { address: owner, chain, approvals: [], totalCount: 0 }
  }

  // Per pair: read current allowance + symbol (parallel, fail-soft).
  const probed = await Promise.all(
    pairs.map(async ({ token, spender }) => {
      const [allowance, symbol] = await Promise.all([
        readAllowance(client, token, owner, spender),
        readSymbol(client, token),
      ])
      return { token, spender, allowance, symbol }
    })
  )

  const approvals: TokenApproval[] = probed
    .filter(p => p.allowance > 0n)
    .slice(0, MAX_PAIRS)
    .map(p => ({
      tokenAddress: p.token,
      tokenSymbol: p.symbol,
      spenderAddress: p.spender,
      allowance: p.allowance,
      isUnlimited: p.allowance >= UNLIMITED_THRESHOLD,
    }))

  return { address: owner, chain, approvals, totalCount: approvals.length }
}
