import { encodeFunctionData, erc20Abi, getAddress, isAddress } from 'viem'

/**
 * GLIF x ICN — Base ICNT liquid-staking primitive.
 *
 * Builds UNSIGNED EVM calldata ONLY for staking ICNT into the GLIF x ICN pool
 * (mint stICNT) and redeeming stICNT back into ICNT. This module NEVER signs,
 * broadcasts, or holds keys — it returns the raw `{ to, value, data }` tuples a
 * consumer (agent-backend, mcp-ts, vultiagent-app) hands to its own signer.
 *
 * Pure crypto: the builders are deterministic and offline by default. Pass an
 * `evmCall` reader (e.g. the SDK's `evmCall('Base', ...)`) only when a consumer
 * wants live on-chain verification / preview / balance guards.
 */

/** ICNT / stICNT both use 18 decimals. */
export const GLIF_ICN_TOKEN_DECIMALS = 18

/** uint256 ceiling — used to reject overflowing amounts before encoding. */
const MAX_UINT256 = (1n << 256n) - 1n

/**
 * Base mainnet GLIF x ICN deployed addresses.
 *
 * Pinned from GLIF x ICN's official deployed-contracts docs (re-verified live
 * against the proxy surface). Pool + periphery are proxy contracts; GLIF docs
 * instruct manual callers to use the implementation ABI.
 */
export const GLIF_ICN_BASE_ADDRESSES = {
  /** ICNT ERC-20 — the staked asset. */
  icnt: getAddress('0xE0Cd4cAcDdcBF4f36e845407CE53E87717b6601d'),
  /** stICNT ERC-4626-style staking pool (proxy). */
  pool: getAddress('0xAeD7C2eD7Bb84396AfCB55fF72c8F8E87FFb68f3'),
  /** Read-only periphery (apy/tvl/health, proxy). */
  periphery: getAddress('0x3a24CFF2F5c9af8e77775418A115214e171112B8'),
} as const

/** Minimal ERC-4626-style pool ABI: deposit (stake) + redeem (unstake). */
export const glifPoolWriteAbi = [
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'assets', type: 'uint256' },
      { name: 'receiver', type: 'address' },
    ],
    outputs: [{ name: 'shares', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'redeem',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'shares', type: 'uint256' },
      { name: 'receiver', type: 'address' },
      { name: 'owner', type: 'address' },
    ],
    outputs: [{ name: 'assets', type: 'uint256' }],
  },
] as const

/** A single unsigned EVM transaction (no gas/nonce — the consumer's signer fills those). */
export type GlifUnsignedTx = {
  /** Target contract. */
  to: `0x${string}`
  /** Native value, always '0' for these ERC-20/4626 flows. */
  value: '0'
  /** ABI-encoded calldata. */
  data: `0x${string}`
  /** High-level action label: 'approve' | 'deposit' | 'redeem'. */
  action: 'approve' | 'deposit' | 'redeem'
}

export type BuildGlifStakeParams = {
  /** Staker / receiver address (the stICNT mints back here). */
  from: string
  /** ICNT asset amount to stake, in 18-decimal base units (wei). */
  assetAmount: bigint
  /**
   * Current ICNT allowance the `from` address has granted the pool. When
   * provided and >= assetAmount the approve step is dropped; omit it (or pass 0n)
   * to always prepend an approve.
   *
   * NOTE: this is a BUILD-TIME snapshot — consumers MUST re-check the live
   * allowance at send time; a delayed or multi-consumer execution may render
   * this stale (approve missing when needed, or redundant).
   */
  currentAllowance?: bigint
  /**
   * Receiver of the minted stICNT. Defaults to `from`. INJECTABLE so a
   * multi-consumer (vault, smart-account, treasury) can route shares — never
   * hardcoded. Pinning to `from` keeps the default free of any arbitrary-payout
   * surface.
   */
  receiver?: string
}

export type BuildGlifStakeResult = {
  protocol: 'GLIF x ICN'
  chain: 'Base'
  chainId: 8453
  action: 'glif_stake_icnt'
  from: `0x${string}`
  receiver: `0x${string}`
  pool: `0x${string}`
  asset: `0x${string}`
  /** ICNT asset amount deposited, in 18-decimal base units. */
  assetAmount: bigint
  /** True when an approve tx was prepended (allowance was insufficient). */
  approvalRequired: boolean
  /** The unsigned tx sequence: [approve?, deposit]. */
  transactions: GlifUnsignedTx[]
}

export type BuildGlifRedeemParams = {
  /** stICNT owner address. */
  from: string
  /** stICNT share amount to redeem, in 18-decimal base units (wei). */
  shareAmount: bigint
  /**
   * Receiver of the redeemed ICNT. Defaults to `from`. INJECTABLE (see stake);
   * default pins to the owner so the builder exposes no third-party payout path.
   */
  receiver?: string
}

export type BuildGlifRedeemResult = {
  protocol: 'GLIF x ICN'
  chain: 'Base'
  chainId: 8453
  action: 'glif_redeem_sticnt'
  from: `0x${string}`
  receiver: `0x${string}`
  pool: `0x${string}`
  asset: `0x${string}`
  /** stICNT share amount redeemed, in 18-decimal base units. */
  shareAmount: bigint
  /** The unsigned tx sequence: [redeem]. */
  transactions: GlifUnsignedTx[]
}

function normalizeAmount(amount: bigint, field: string): bigint {
  if (typeof amount !== 'bigint') throw new Error(`${field}: amount must be a bigint (18-decimal base units)`)
  if (amount <= 0n) throw new Error(`${field}: amount must be positive`)
  if (amount > MAX_UINT256) throw new Error(`${field}: amount overflows uint256`)
  return amount
}

function normalizeAddress(raw: string, field: string): `0x${string}` {
  const trimmed = String(raw ?? '').trim()
  if (!trimmed) throw new Error(`${field}: address is required`)
  if (!isAddress(trimmed, { strict: false })) throw new Error(`${field}: invalid address "${trimmed}"`)
  return getAddress(trimmed)
}

/**
 * Build the unsigned Base tx sequence to STAKE ICNT into GLIF x ICN (mint stICNT).
 *
 * Returns `[approve?, deposit]`. The approve step is included only when
 * `currentAllowance` is missing or below `assetAmount`. Pure / offline — no RPC.
 *
 * @example
 * ```ts
 * const { transactions } = buildGlifStakeIcnt({
 *   from: '0xabc...',
 *   assetAmount: 10n ** 18n, // 1 ICNT
 * })
 * ```
 */
export function buildGlifStakeIcnt(params: BuildGlifStakeParams): BuildGlifStakeResult {
  const from = normalizeAddress(params.from, 'from')
  const receiver = params.receiver ? normalizeAddress(params.receiver, 'receiver') : from
  const assetAmount = normalizeAmount(params.assetAmount, 'assetAmount')
  const currentAllowance = params.currentAllowance ?? 0n
  if (currentAllowance < 0n) throw new Error('currentAllowance: must be non-negative')

  const approvalRequired = currentAllowance < assetAmount
  const transactions: GlifUnsignedTx[] = []

  if (approvalRequired) {
    transactions.push({
      to: GLIF_ICN_BASE_ADDRESSES.icnt,
      value: '0',
      action: 'approve',
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [GLIF_ICN_BASE_ADDRESSES.pool, assetAmount],
      }),
    })
  }

  transactions.push({
    to: GLIF_ICN_BASE_ADDRESSES.pool,
    value: '0',
    action: 'deposit',
    data: encodeFunctionData({
      abi: glifPoolWriteAbi,
      functionName: 'deposit',
      args: [assetAmount, receiver],
    }),
  })

  return {
    protocol: 'GLIF x ICN',
    chain: 'Base',
    chainId: 8453,
    action: 'glif_stake_icnt',
    from,
    receiver,
    pool: GLIF_ICN_BASE_ADDRESSES.pool,
    asset: GLIF_ICN_BASE_ADDRESSES.icnt,
    assetAmount,
    approvalRequired,
    transactions,
  }
}

/**
 * Build the unsigned Base tx to REDEEM stICNT back into ICNT via GLIF x ICN.
 *
 * Single-step `redeem(shares, receiver, owner)`. Pure / offline — no RPC. GLIF
 * docs note redemptions draw on the pool exit reserve and include a 0.5%
 * withdrawal fee; a consumer that wants to pre-check exit liquidity should read
 * it on-chain itself before calling this builder.
 *
 * @example
 * ```ts
 * const { transactions } = buildGlifRedeemSticnt({
 *   from: '0xabc...',
 *   shareAmount: 10n ** 18n, // 1 stICNT
 * })
 * ```
 */
export function buildGlifRedeemSticnt(params: BuildGlifRedeemParams): BuildGlifRedeemResult {
  const from = normalizeAddress(params.from, 'from')
  const receiver = params.receiver ? normalizeAddress(params.receiver, 'receiver') : from
  const shareAmount = normalizeAmount(params.shareAmount, 'shareAmount')

  const data = encodeFunctionData({
    abi: glifPoolWriteAbi,
    functionName: 'redeem',
    args: [shareAmount, receiver, from],
  })

  return {
    protocol: 'GLIF x ICN',
    chain: 'Base',
    chainId: 8453,
    action: 'glif_redeem_sticnt',
    from,
    receiver,
    pool: GLIF_ICN_BASE_ADDRESSES.pool,
    asset: GLIF_ICN_BASE_ADDRESSES.icnt,
    shareAmount,
    transactions: [
      {
        to: GLIF_ICN_BASE_ADDRESSES.pool,
        value: '0',
        action: 'redeem',
        data,
      },
    ],
  }
}
