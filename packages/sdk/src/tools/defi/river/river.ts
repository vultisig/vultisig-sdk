import { EvmChain } from '@vultisig/core-chain/Chain'
import { evmChainInfo } from '@vultisig/core-chain/chains/evm/chainInfo'
import { getEvmClient } from '@vultisig/core-chain/chains/evm/client'
import { encodeFunctionData, getAddress } from 'viem'

import {
  RIVER_BORROWER_OPS_ABI,
  RIVER_PERIPHERY_ABI,
  RIVER_SORTED_TROVES_ABI,
  RIVER_TROVE_MANAGER_ABI,
} from './abi'
import {
  RIVER_CHAIN_CONFIG,
  RIVER_DEFAULT_MAX_FEE_BPS,
  RIVER_NICR_PRECISION,
  RIVER_ZERO_ADDRESS,
  type RiverChain,
} from './constants'

/**
 * An unsigned EVM transaction request. Pure calldata: this module NEVER signs
 * or broadcasts — the consumer feeds this into its own keysign/broadcast path.
 */
export type RiverUnsignedTx = {
  to: `0x${string}`
  /** Wei value to attach (native-collateral opens require a non-zero value). */
  value: string
  data: `0x${string}`
  chain: RiverChain
  chainId: number
}

export type RiverTxBuild<TMeta> = {
  tx: RiverUnsignedTx
  meta: TMeta
}

/**
 * Optional affiliate/fee config. The SDK is multi-consumer, so this is fully
 * INJECTABLE and defaults to neutral/off — never hardcode a specific consumer.
 *
 * River's `openTrove` exposes `maxFeePercentage` (the borrowing-fee tolerance,
 * protocol-native, NOT a kickback). `maxFeeBps` lets a consumer tune it; it
 * defaults to River's conventional 5%. `affiliateTag` is an opaque, off-chain
 * label echoed back into `meta` for the consumer's own attribution — it is
 * NEVER written to calldata.
 */
export type RiverAffiliateConfig = {
  /** Max borrowing-fee tolerance in basis points (1..5000). Default 500 = 5%. */
  maxFeeBps?: number
  /** Opaque consumer attribution label, echoed in meta only. Default: none. */
  affiliateTag?: string
}

function chainId(chain: RiverChain): number {
  return evmChainInfo[chain].id
}

function toWadFromBps(bps: bigint): bigint {
  return (bps * 10n ** 18n) / 10000n
}

function formatPercentWad(value: bigint): string {
  const scaled = (value * 10000n) / 10n ** 18n
  const whole = scaled / 100n
  const frac = (scaled % 100n).toString().padStart(2, '0')
  return `${whole.toString()}.${frac}`
}

async function readUint(
  chain: RiverChain,
  to: `0x${string}`,
  abi: readonly unknown[],
  functionName: string,
  args: readonly unknown[] = []
): Promise<bigint> {
  const client = getEvmClient(chain as EvmChain)
  const result = await client.readContract({
    address: to,
    abi: abi as never,
    functionName: functionName as never,
    args: args as never,
  })
  return BigInt(result as bigint)
}

async function readAddress(
  chain: RiverChain,
  to: `0x${string}`,
  abi: readonly unknown[],
  functionName: string,
  args: readonly unknown[] = []
): Promise<`0x${string}`> {
  const client = getEvmClient(chain as EvmChain)
  const result = await client.readContract({
    address: to,
    abi: abi as never,
    functionName: functionName as never,
    args: args as never,
  })
  return getAddress(result as string)
}

export type RiverMarket = {
  troveManager: `0x${string}`
  collateralToken: `0x${string}`
  sortedTroves: `0x${string}`
  mcr: bigint
}

/** Resolve a market's on-chain references (collateral token, sorted troves, MCR). */
export async function describeRiverMarket(chain: RiverChain, troveManager: `0x${string}`): Promise<RiverMarket> {
  const [collateralToken, sortedTroves, mcr] = await Promise.all([
    readAddress(chain, troveManager, RIVER_TROVE_MANAGER_ABI, 'collateralToken'),
    readAddress(chain, troveManager, RIVER_TROVE_MANAGER_ABI, 'sortedTroves'),
    readUint(chain, troveManager, RIVER_TROVE_MANAGER_ABI, 'MCR'),
  ])
  return { troveManager: getAddress(troveManager), collateralToken, sortedTroves, mcr }
}

/**
 * Walk the sorted-troves list to find the insert position for a target NICR.
 * Mirrors River's public Solidity hint helper.
 */
export async function findRiverInsertHints(args: {
  chain: RiverChain
  troveManager: `0x${string}`
  sortedTroves: `0x${string}`
  targetNicr: bigint
  skipBorrower?: `0x${string}`
}): Promise<{ upperHint: `0x${string}`; lowerHint: `0x${string}` }> {
  let prev = RIVER_ZERO_ADDRESS as `0x${string}`
  let current = await readAddress(args.chain, args.sortedTroves, RIVER_SORTED_TROVES_ABI, 'getFirst')

  while (current !== RIVER_ZERO_ADDRESS) {
    if (!args.skipBorrower || current.toLowerCase() !== args.skipBorrower.toLowerCase()) {
      const nicr = await readUint(args.chain, args.troveManager, RIVER_TROVE_MANAGER_ABI, 'getNominalICR', [current])
      if (args.targetNicr > nicr) {
        return { upperHint: prev, lowerHint: current }
      }
      prev = current
    }
    current = await readAddress(args.chain, args.sortedTroves, RIVER_SORTED_TROVES_ABI, 'getNext', [current])
  }

  return { upperHint: prev, lowerHint: RIVER_ZERO_ADDRESS as `0x${string}` }
}

// ---------------------------------------------------------------------------
// Builders — all return UNSIGNED calldata only. No signing, no broadcast.
// ---------------------------------------------------------------------------

export type BuildRiverDelegateApprovalParams = {
  chain: RiverChain
  /** true = enable River periphery as delegate, false = revoke. Default true. */
  approved?: boolean
}

export type RiverDelegateApprovalMeta = {
  protocol: 'River Omni-CDP'
  action: 'set_delegate_approval'
  approved: boolean
  delegate: `0x${string}`
  app: `0x${string}`
  docsUrl: string
}

/**
 * Build the River prerequisite tx that authorizes River's SatoshiPeriphery to
 * act as a delegate for borrower operations. Fully offline — no RPC.
 */
export function buildRiverDelegateApproval(
  params: BuildRiverDelegateApprovalParams
): RiverTxBuild<RiverDelegateApprovalMeta> {
  const { chain } = params
  const config = RIVER_CHAIN_CONFIG[chain]
  const approved = params.approved ?? true

  const data = encodeFunctionData({
    abi: RIVER_BORROWER_OPS_ABI,
    functionName: 'setDelegateApproval',
    args: [config.periphery, approved],
  })

  return {
    tx: { to: config.app, value: '0', data, chain, chainId: chainId(chain) },
    meta: {
      protocol: 'River Omni-CDP',
      action: 'set_delegate_approval',
      approved,
      delegate: config.periphery,
      app: config.app,
      docsUrl: `https://docs.river.inc/outro/deployed-contracts/${config.docsSlug}`,
    },
  }
}

export type BuildRiverOpenTroveParams = {
  chain: RiverChain
  /** Exact River trove-manager address for the market. */
  troveManager: `0x${string}`
  /** Collateral amount in base units (e.g. wei for WETH). */
  collateralAmount: bigint
  /** satUSD debt to mint, base units (18 decimals). */
  debtAmount: bigint
  /**
   * Pre-resolved insert hints. When omitted, the builder reads the sorted-troves
   * list on-chain to compute them. Pass explicit hints (and `resolveOnChain:false`)
   * for a fully offline build.
   */
  upperHint?: `0x${string}`
  lowerHint?: `0x${string}`
  /** Gas-compensation debt added to total debt when computing the NICR hint target. */
  gasCompensation?: bigint
  /** Injectable fee/affiliate config. Defaults neutral (5% max-fee tolerance, no tag). */
  affiliate?: RiverAffiliateConfig
}

export type RiverOpenTroveMeta = {
  protocol: 'River Omni-CDP'
  action: 'open_trove'
  troveManager: `0x${string}`
  collateralAmountBaseUnits: string
  debtAmountBaseUnits: string
  maxFeeBps: number
  maxFeePercentageWad: string
  upperHint: `0x${string}`
  lowerHint: `0x${string}`
  nativeCollateral: boolean
  collateralApprovalRequired: boolean
  collateralApprovalSpender: `0x${string}` | null
  affiliateTag: string | null
  docsUrl: string
}

/**
 * Build a River open-trove tx through the SatoshiPeriphery.
 *
 * Offline-capable: pass explicit `upperHint`/`lowerHint` to avoid any RPC. When
 * hints are omitted, the sorted-troves list is read on-chain to place the trove.
 */
export async function buildRiverOpenTrove(
  params: BuildRiverOpenTroveParams
): Promise<RiverTxBuild<RiverOpenTroveMeta>> {
  const { chain, troveManager, collateralAmount, debtAmount } = params
  const config = RIVER_CHAIN_CONFIG[chain]

  const maxFeeBps = BigInt(params.affiliate?.maxFeeBps ?? Number(RIVER_DEFAULT_MAX_FEE_BPS))
  if (maxFeeBps < 1n || maxFeeBps > 5000n) {
    throw new Error(`buildRiverOpenTrove: maxFeeBps must be in 1..5000, got ${maxFeeBps.toString()}`)
  }
  const maxFeeWad = toWadFromBps(maxFeeBps)

  let upperHint = params.upperHint
  let lowerHint = params.lowerHint
  let collateralToken: `0x${string}` | undefined

  if (!upperHint || !lowerHint) {
    const market = await describeRiverMarket(chain, troveManager)
    collateralToken = market.collateralToken
    const totalDebt = debtAmount + (params.gasCompensation ?? 0n)
    if (totalDebt === 0n) {
      throw new Error('buildRiverOpenTrove: debtAmount (plus gasCompensation) must be > 0 to place a trove hint')
    }
    const targetNicr = (collateralAmount * RIVER_NICR_PRECISION) / totalDebt
    const hints = await findRiverInsertHints({
      chain,
      troveManager,
      sortedTroves: market.sortedTroves,
      targetNicr,
    })
    upperHint = upperHint ?? hints.upperHint
    lowerHint = lowerHint ?? hints.lowerHint
  }

  const data = encodeFunctionData({
    abi: RIVER_PERIPHERY_ABI,
    functionName: 'openTrove',
    args: [troveManager, maxFeeWad, collateralAmount, debtAmount, upperHint, lowerHint],
  })

  const nativeCollateral =
    !!config.wrappedNative && !!collateralToken && config.wrappedNative.toLowerCase() === collateralToken.toLowerCase()
  const value = nativeCollateral ? collateralAmount.toString() : '0'

  return {
    tx: { to: config.periphery, value, data, chain, chainId: chainId(chain) },
    meta: {
      protocol: 'River Omni-CDP',
      action: 'open_trove',
      troveManager: getAddress(troveManager),
      collateralAmountBaseUnits: collateralAmount.toString(),
      debtAmountBaseUnits: debtAmount.toString(),
      maxFeeBps: Number(maxFeeBps),
      maxFeePercentageWad: maxFeeWad.toString(),
      upperHint,
      lowerHint,
      nativeCollateral,
      collateralApprovalRequired: !nativeCollateral,
      collateralApprovalSpender: nativeCollateral ? null : config.periphery,
      affiliateTag: params.affiliate?.affiliateTag ?? null,
      docsUrl: `https://docs.river.inc/outro/deployed-contracts/${config.docsSlug}`,
    },
  }
}

export type BuildRiverCloseTroveParams = {
  chain: RiverChain
  /** Exact River trove-manager address for the market. */
  troveManager: `0x${string}`
  /** Injectable affiliate config (echoed in meta only). */
  affiliate?: RiverAffiliateConfig
}

export type RiverCloseTroveMeta = {
  protocol: 'River Omni-CDP'
  action: 'close_trove'
  troveManager: `0x${string}`
  satUsdApprovalRequired: true
  satUsdApprovalSpender: `0x${string}`
  affiliateTag: string | null
  docsUrl: string
}

/**
 * Build a River close-trove tx through the SatoshiPeriphery. Fully offline.
 *
 * NOTE: closing requires the borrower to have approved satUSD repayment to the
 * periphery beforehand (surfaced via `satUsdApprovalRequired` in meta). This
 * builder produces only the close calldata — the consumer sequences approvals.
 */
export function buildRiverCloseTrove(params: BuildRiverCloseTroveParams): RiverTxBuild<RiverCloseTroveMeta> {
  const { chain, troveManager } = params
  const config = RIVER_CHAIN_CONFIG[chain]

  const data = encodeFunctionData({
    abi: RIVER_PERIPHERY_ABI,
    functionName: 'closeTrove',
    args: [troveManager],
  })

  return {
    tx: { to: config.periphery, value: '0', data, chain, chainId: chainId(chain) },
    meta: {
      protocol: 'River Omni-CDP',
      action: 'close_trove',
      troveManager: getAddress(troveManager),
      satUsdApprovalRequired: true,
      satUsdApprovalSpender: config.periphery,
      affiliateTag: params.affiliate?.affiliateTag ?? null,
      docsUrl: `https://docs.river.inc/outro/deployed-contracts/${config.docsSlug}`,
    },
  }
}

export { formatPercentWad as formatRiverPercentWad }
