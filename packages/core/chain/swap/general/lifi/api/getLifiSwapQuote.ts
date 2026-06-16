import { ChainId, getQuote } from '@lifi/sdk'
import { DeriveChainKind, getChainKind } from '@vultisig/core-chain/ChainKind'
import { solanaConfig } from '@vultisig/core-chain/chains/solana/solanaConfig'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import {
  getLifiClient,
  LifiAffiliateConfig,
  lifiConfig,
  setupLifi,
} from '@vultisig/core-chain/swap/general/lifi/config'
import { lifiSwapChainId, LifiSwapEnabledChain } from '@vultisig/core-chain/swap/general/lifi/LifiSwapEnabledChains'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'
import { match } from '@vultisig/lib-utils/match'
import { memoize } from '@vultisig/lib-utils/memoize'
import { mirrorRecord } from '@vultisig/lib-utils/record/mirrorRecord'
import { TransferDirection } from '@vultisig/lib-utils/TransferDirection'

import { AccountCoinKey } from '../../../../coin/AccountCoin'
import { GeneralSwapQuote } from '../../GeneralSwapQuote'
import { injectSolanaAtaIfMissing } from './injectSolanaAtaIfMissing'

type Input = Record<TransferDirection, AccountCoinKey<LifiSwapEnabledChain> & { ticker?: string }> & {
  amount: bigint
  affiliateBps?: number
  /** Consumer-supplied LI.FI integrator override. When omitted, falls back
   * to the global `lifiConfig.integratorName` (vultisig-0 by default). */
  lifiAffiliateConfig?: LifiAffiliateConfig
}

// Stable-pair detection: tickers that commonly trade within a tight peg.
// DAI is included because on most DEXs DAI/USDC depth is comparable to
// USDC/USDT and the 0.3% ceiling is still safe headroom for MPC latency.
/** @internal exported for unit tests only */
export const STABLE_TICKERS: ReadonlySet<string> = new Set([
  'USDC',
  'USDT',
  'DAI',
  'BUSD',
  'TUSD',
  'FRAX',
  'USDP',
  'GUSD',
  'LUSD',
  'USDD',
  'FDUSD',
  'PYUSD',
])

const isStableTicker = (ticker: string | undefined): boolean =>
  ticker !== undefined && STABLE_TICKERS.has(ticker.toUpperCase())

/** @internal exported for unit tests only */
export const isStablePair = (from: { ticker?: string }, to: { ticker?: string }): boolean =>
  isStableTicker(from.ticker) && isStableTicker(to.ticker)

/** Lazy bootstrap for callers that never invoked the public `setupLifi`
 * — uses whatever defaults sit on `lifiConfig` (vultisig-0 + no apiUrl
 * unless a consumer mutated them at module load). The public `setupLifi`
 * exported from ../config is idempotent and short-circuits subsequent
 * calls, so this is safe to call on every quote. */
const ensureLifiConfigured = memoize(() => {
  setupLifi()
})

// Slippage tolerance baked into the LiFi-prebuilt swap tx. The
// returned `transactionRequest.data` is a fully-formed Solana / EVM
// transaction that encodes a minAmountOut floor at quote time —
// the underlying AMM (Raydium / Orca / Meteora on Solana; Uniswap /
// 1inch on EVM) reverts if simulation-time output drops below the
// floor. Default LiFi slippage is 0.005 (0.5%), which is far too
// tight for MPC-signed flows where the keysign ceremony adds
// 30-90s of clock drift between quote and broadcast and the price
// routinely moves more than 0.5% on volatile pairs (SOL/USDC,
// SOL/anything memecoin). Production repro (2026-05-22):
// SOL→USDC simulation failed with `-32002: custom program error:
// 0x32` (Raydium AMM error 50 = AmountExceedsMaximum / slippage
// exceeded). Bump to 1% — covers the typical ceremony drift while
// staying well inside the user's pre-sign card's risk surface
// (typical realised slippage on these aggregators is <0.1%, so
// the 1% is a ceiling, not the expected price hit).
//
// EVM is less time-sensitive — the model dispatches and the user
// signs in seconds, but the same 1% bump still helps cover block
// time variance during mempool pending (~12s on ETH, ~2s on L2s).
// On WalletConnect / injected signers the dapp typically re-fetches
// the quote at MetaMask/Rainbow signing time, so quote staleness from
// user pause on the pre-sign card is NOT the failure mode — block-
// time variance during pending is. (NeOMakinG #513 round 1 CR
// `should-fix` 1 — comment was misleading pre-fix.)
//
// **Cross-chain bridge+swap caveat (NeOMakinG #513 round 1
// `preferably-blocking`).** This 1% slippage applies to the FINAL
// destination amount only. LiFi cross-chain routes (Stargate, Across,
// Hop + destination AMM swap) have TWO slippage points: (1) bridge
// liquidity pool exit on the source chain, (2) destination AMM swap.
// Intermediate bridge slippage is managed by bridge protocols' own
// limits and is NOT covered by this 1% floor — so total realised
// slippage on a SOL→ETH→USDC route could be 2-3% even when this
// constant says "1%". Document the bridge cost explicitly to users
// when surfacing cross-chain quote previews; don't rely on this
// constant as the single source of truth for cross-chain slippage.
//
// Hoisted to module scope so the planned per-pair / per-call
// override (forwarding `execute_swap.slippage_tolerance_percent`
// through the resolver, tracked at vultisig/vultisig-sdk#NEW — TODO
// open) lands as a clean diff rather than reshaping the function
// body. Codex Round 1b review feedback (vultisig-sdk#513 r1).
//
// Two tiers (vultisig-sdk#524):
// - stable pairs (USDC/USDT/DAI/...): 0.3% — well above typical
//   concentrated-liquidity spread (0.02-0.05%) but avoids the 1%
//   MEV surface on tight-peg operations.
// - volatile pairs: 1% — covers MPC ceremony latency (30-90s) where
//   price can move >0.5% on thin pairs. See full rationale above.
const DEFAULT_LIFI_SLIPPAGE_TOLERANCE = 0.01
const STABLE_PAIR_LIFI_SLIPPAGE_TOLERANCE = 0.003

// Combined affiliate + slippage ceiling. Defensive guard so a high
// affiliateBps + the 1% slippage don't silently combine into a >3%
// effective cost on the user without anyone noticing. Logged-only,
// not a hard reject — getQuote will still dispatch. NeOMakinG #513
// round 1 `suggestion` 1.
const MAX_COMBINED_COST_BPS = 300

// Resolve a LiFi fee-token `chainId` back to a Vultisig `LifiSwapEnabledChain`.
//
// `mirrorRecord(lifiSwapChainId)` is a closed, build-time map of LI.FI source
// chains (EVM chains Vultisig exposes + Solana). LI.FI's `feeCosts[].token`
// is *not* guaranteed by the API contract to live on the source chain — for
// cross-chain routes (e.g. EVM → Cosmos via Stargate, EVM → BTC via THORChain
// relay) the fee can be denominated on an intermediate chain whose ID is not
// a key in this map. `mirrorRecord(...)[unknownChainId]` then silently yields
// `undefined`, producing `affiliateFee.chain = undefined`, which serializes
// as an absent `swap_fee_chain` field alongside a non-empty `swap_fee` —
// exactly the ambiguous state this PR set out to eliminate.
//
// Fall back to `transfer.from.chain` because LiFi's fixed fee is collected
// from the user's source-chain wallet regardless of which bridge leg
// denominates it internally, and the source chain is always a
// `LifiSwapEnabledChain` (guaranteed by the `Input` type). Warn so any
// future LiFi behavioural drift is visible in ops telemetry rather than
// silently misattributed. (NeOMakinG #540 review blocking #1.)
const resolveSwapFeeChain = (chainId: ChainId, fallback: LifiSwapEnabledChain): LifiSwapEnabledChain => {
  const resolved = mirrorRecord(lifiSwapChainId)[chainId]
  if (resolved === undefined) {
    console.warn(`[getLifiSwapQuote] fee token chainId ${chainId} not in lifiSwapChainId; falling back to ${fallback}`)
    return fallback
  }
  return resolved
}

export const getLifiSwapQuote = async ({
  amount,
  affiliateBps,
  lifiAffiliateConfig,
  ...transfer
}: Input): Promise<GeneralSwapQuote> => {
  ensureLifiConfigured()

  const [fromChain, toChain] = [transfer.from, transfer.to].map(({ chain }) => lifiSwapChainId[chain])

  const [fromToken, toToken] = [transfer.from, transfer.to].map(({ id, chain }) => id ?? chainFeeCoin[chain].ticker)
  const [fromAddress, toAddress] = [transfer.from, transfer.to].map(({ address }) => address)

  const slippage = isStablePair(transfer.from, transfer.to)
    ? STABLE_PAIR_LIFI_SLIPPAGE_TOLERANCE
    : DEFAULT_LIFI_SLIPPAGE_TOLERANCE

  // Defensive: log when affiliate + slippage combined cost crosses the
  // 3% ceiling. Today affiliateBps is typically 0 and slippage is 1%,
  // so 100bps total — well under the ceiling — but a future bump to
  // affiliateBps shouldn't silently combine into a >3% effective cost
  // on the user without anyone noticing. NeOMakinG #513 r1.
  const combinedCostBps = (affiliateBps ?? 0) + slippage * 10000
  if (combinedCostBps > MAX_COMBINED_COST_BPS) {
    console.warn(
      `[getLifiSwapQuote] affiliate + slippage combined cost exceeds ${MAX_COMBINED_COST_BPS}bps: ${combinedCostBps}bps`
    )
  }

  // Per-call integrator override — when the consumer supplied a
  // `lifiAffiliateConfig` (e.g. Station via mcp-ts) the affiliate fee
  // for THIS quote is tagged to their portal integrator instead of the
  // SDK-default. Falls back to whatever `lifiConfig.integratorName`
  // resolves to (vultisig-0 unless the consumer's setupLifi() ran first).
  const integrator = lifiAffiliateConfig?.integratorName ?? lifiConfig.integratorName

  // v4: actions take the SDK client as their first argument (the v3 global
  // mutable singleton is gone). `ensureLifiConfigured()` above guarantees the
  // client is initialised before this call.
  const quote = await getQuote(getLifiClient(), {
    fromChain,
    toChain,
    fromToken,
    toToken,
    fromAmount: amount.toString(),
    fromAddress,
    toAddress,
    // NeOMakinG #618 r2 should-fix: explicit `undefined` only when affiliateBps
    // is genuinely unset. `affiliateBps: 0` previously fell into the truthy-test
    // and became `undefined`, which let LiFi's getQuote silently fall back to
    // `_config.routeOptions?.fee` (see @lifi/sdk src/services/api.js: `params.fee
    // ??= _config.routeOptions?.fee`). For a consumer that explicitly set 0,
    // that's a silent non-zero fee. Now: 0 stays 0.
    fee: affiliateBps !== undefined ? affiliateBps / 10000 : undefined,
    slippage,
    integrator,
  })

  const { transactionRequest, estimate } = quote

  const chainKind = getChainKind(transfer.from.chain)

  const { value, gasLimit, data, from, to } = shouldBePresent(transactionRequest)

  // For Solana SPL-token swaps the destination ATA may not yet exist. LiFi's
  // transaction blob won't include the creation instruction in that case, which
  // causes the simulation to revert with custom program error 0x17. We check
  // and inject the instruction before returning the quote data.
  if (chainKind === 'solana' && toToken !== chainFeeCoin[transfer.to.chain].ticker) {
    const rawData = shouldBePresent(data)
    const { gasCosts, feeCosts } = estimate
    const [networkFee] = shouldBePresent(gasCosts)
    const fees = shouldBePresent(feeCosts)
    const swapFee = shouldBePresent(fees.find(fee => fee.name === 'LIFI Fixed Fee') || fees[0])
    const swapFeeAssetId =
      [fromToken, toToken].find(token => token === swapFee.token.address) || chainFeeCoin[transfer.from.chain].id

    const { data: patchedData, ataInjected } = await injectSolanaAtaIfMissing(rawData, toToken, toAddress, fromAddress)
    // Known edge case: LiFi's quote is calculated before ATA injection, so if the
    // payer's SOL balance equals exactly the quoted networkFee, the tx will fail
    // after ATA injection adds the rent cost. We surface the rent buffer in the
    // returned networkFee so the UI can show the correct total to the user, but we
    // do NOT re-validate payer balance here (that would require an extra RPC call
    // and the wallet UI is expected to gate on "insufficient funds" before submit).

    // ATA creation costs ~2,039,280 lamports rent exemption (solanaConfig.ataRentLamports).
    // This is a build-time constant; Solana's rent-exempt threshold can theoretically
    // change via on-chain governance (sysvar::Rent). In practice this value has been
    // stable since mainnet launch — tracking at https://docs.solana.com/developing/runtime-facilities/sysvars#rent.
    // If a governance vote changes the threshold, update solanaConfig.ataRentLamports.
    // A runtime fetch via getMinimumBalanceForRentExemption(AccountLayout.span) would
    // be exact but adds an extra RPC round-trip to every Solana SPL quote; the
    // build-time constant is the deliberate tradeoff here.
    const ataRentBuffer = ataInjected ? BigInt(solanaConfig.ataRentLamports) : 0n

    return {
      dstAmount: estimate.toAmount,
      provider: 'li.fi',
      tx: {
        solana: {
          data: patchedData,
          networkFee: BigInt(networkFee.amount) + ataRentBuffer,
          swapFee: {
            amount: BigInt(swapFee.amount),
            decimals: swapFee.token.decimals,
            chain: resolveSwapFeeChain(swapFee.token.chainId, transfer.from.chain),
            id: swapFeeAssetId,
          },
        },
      },
    }
  }

  return {
    dstAmount: estimate.toAmount,
    provider: 'li.fi',
    tx: match<DeriveChainKind<LifiSwapEnabledChain>, GeneralSwapQuote['tx']>(chainKind, {
      solana: () => {
        const { gasCosts, feeCosts } = estimate
        const [networkFee] = shouldBePresent(gasCosts)

        const fees = shouldBePresent(feeCosts)

        const swapFee = shouldBePresent(fees.find(fee => fee.name === 'LIFI Fixed Fee') || fees[0])

        const swapFeeAssetId =
          [fromToken, toToken].find(token => token === swapFee.token.address) || chainFeeCoin[transfer.from.chain].id

        return {
          solana: {
            data: shouldBePresent(data),
            networkFee: BigInt(networkFee.amount),
            swapFee: {
              amount: BigInt(swapFee.amount),
              decimals: swapFee.token.decimals,
              chain: resolveSwapFeeChain(swapFee.token.chainId, transfer.from.chain),
              id: swapFeeAssetId,
            },
          },
        }
      },
      evm: () => {
        // Mirror the Solana branch's fee extraction so EVM routes
        // (including cross-chain EVM → Solana/Cosmos via Stargate, Across,
        // etc.) surface the affiliate fee. LI.FI's `feeCosts` is the same
        // for both kinds; the EVM branch was previously dropping it on the
        // floor which left the swap-fee row blank for every LI.FI EVM
        // route. Keep `affiliateFee` optional: not every route has one
        // (affiliateBps may be 0 and no LIFI Fixed Fee charged).
        const fees = estimate.feeCosts ?? []
        const swapFee = fees.find(fee => fee.name === 'LIFI Fixed Fee') || fees[0]
        // EVM addresses can come back from LiFi in either lowercase or
        // EIP-55 checksum form; normalize both sides to lowercase so a
        // checksum mismatch doesn't silently fall back to the native
        // fee coin and misattribute the affiliate fee.
        const swapFeeAddress = swapFee?.token.address.toLowerCase()
        const swapFeeAssetId =
          swapFee &&
          ([fromToken, toToken].find(token => token.toLowerCase() === swapFeeAddress) ||
            chainFeeCoin[transfer.from.chain].id)
        return {
          evm: {
            from: shouldBePresent(from),
            to: shouldBePresent(to),
            data: shouldBePresent(data),
            value: BigInt(shouldBePresent(value)).toString(),
            gasLimit: gasLimit ? BigInt(gasLimit) : undefined,
            ...(swapFee
              ? {
                  affiliateFee: {
                    amount: BigInt(swapFee.amount),
                    decimals: swapFee.token.decimals,
                    chain: resolveSwapFeeChain(swapFee.token.chainId, transfer.from.chain),
                    id: swapFeeAssetId,
                  },
                }
              : {}),
          },
        }
      },
    }),
  }
}
