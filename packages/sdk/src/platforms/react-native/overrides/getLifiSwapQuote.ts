// RN override for `@vultisig/core-chain/swap/general/lifi/api/getLifiSwapQuote`.
//
// Historically `@lifi/sdk`'s v3 barrel statically evaluated
// `@wallet-standard/app` (`class AppReadyEvent extends Event` at module
// top-level), which Hermes chokes on without the `Event`/`EventTarget` DOM
// globals. This override defers the heavy LI.FI action surface (`getQuote`)
// behind an `await import('@lifi/sdk')` inside the async body so it only
// evaluates once a swap quote is actually requested, after the RN entry's
// polyfills are in place.
//
// NOTE (v4 migration): the v4 barrel is lighter and no longer ships the
// `@wallet-standard/app`/`Event` top-level path. The `await import()` here
// is kept as belt-and-suspenders, but it is NOT the sole deferral point:
// `config.ts` (shared by core + RN, no RN override) value-imports
// `createClient` from `@lifi/sdk`, so the barrel is part of the static graph
// regardless. That was already true in v3 (config.ts value-imported
// `createConfig`) and the RN build shipped working, so v4 is risk-neutral.
// The client is built inside `setupLifi()`; we just fetch it via
// `getLifiClient()` and thread it into `getQuote(client, params)`.
//
// Public surface mirrors core byte-for-byte: one `getLifiSwapQuote(input)`
// export returning `Promise<GeneralSwapQuote>`.
import type { ChainId } from '@lifi/sdk'
import { DeriveChainKind, getChainKind } from '@vultisig/core-chain/ChainKind'
import { solanaConfig } from '@vultisig/core-chain/chains/solana/solanaConfig'
import { AccountCoinKey } from '@vultisig/core-chain/coin/AccountCoin'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { GeneralSwapQuote } from '@vultisig/core-chain/swap/general/GeneralSwapQuote'
import { injectSolanaAtaIfMissing } from '@vultisig/core-chain/swap/general/lifi/api/injectSolanaAtaIfMissing'
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

type Input = Record<TransferDirection, AccountCoinKey<LifiSwapEnabledChain>> & {
  amount: bigint
  affiliateBps?: number
  /** Consumer-supplied LI.FI integrator override — mirrors the core
   * `getLifiSwapQuote` Input. Threaded through to the per-call `integrator`
   * arg on `getQuote` so RN consumers get the same affiliate-routing surface
   * as Node consumers. (Ehsan-saradar #618 review.) */
  lifiAffiliateConfig?: LifiAffiliateConfig
}

// 1% slippage tolerance — same as core implementation (see getLifiSwapQuote.ts in core).
// MPC keysign ceremony latency makes the default LiFi 0.5% too tight for Vultisig flows.
const DEFAULT_LIFI_SLIPPAGE_TOLERANCE = 0.01

// Mirror of core's MAX_COMBINED_COST_BPS guard. Defensive: logs when affiliate
// + slippage combined cost crosses 3%. Today affiliateBps is typically 0 and
// slippage is 1% (100bps total) — well under the ceiling — but a future bump to
// affiliateBps shouldn't silently push users past 3% total cost without logging.
// (#519 r-N NeO should-fix #3 - mirror core guard in RN override.)
const MAX_COMBINED_COST_BPS = 300

// Mirror of core's `resolveSwapFeeChain`. See the core version in
// `@vultisig/core-chain/swap/general/lifi/api/getLifiSwapQuote.ts` for the
// full rationale: `mirrorRecord(lifiSwapChainId)[unknownChainId]` silently
// returns `undefined` for cross-chain routes whose fee token lives on an
// intermediate chain that is not a `LifiSwapEnabledChain`, producing an
// ambiguous `swap_fee` non-empty + `swap_fee_chain` absent state on the
// cosigner. Fall back to the source chain and warn so the drift is visible.
// (NeOMakinG #540 review blocking #1.)
const resolveSwapFeeChain = (chainId: ChainId, fallback: LifiSwapEnabledChain): LifiSwapEnabledChain => {
  const resolved = mirrorRecord(lifiSwapChainId)[chainId]
  if (resolved === undefined) {
    console.warn(`[getLifiSwapQuote] fee token chainId ${chainId} not in lifiSwapChainId; falling back to ${fallback}`)
    return fallback
  }
  return resolved
}

// RN-specific bootstrap. Mirrors the `ensureLifiConfigured` pattern from
// core's `getLifiSwapQuote.ts`. Runs `setupLifi()` exactly once via the
// `memoize` wrapper; subsequent quote calls hit the cached return and skip
// the work entirely. setupLifi's lazy branch then calls `createClient`
// exactly once via its own `configured` latch, building the v4 SDK client
// at first-quote time, not per-quote. (NeOMakinG #618 r2 blocker.)
//
// Consumer-bootstrap path stays safe: an explicit
// `setupLifi({integratorName, apiUrl})` called from a consumer app's boot
// path overwrites `lifiConfig` and re-runs `createClient` once at that
// point. The memoize'd `ensureLifiConfiguredInRN` then no-ops on quotes
// because `configured = true` is already set inside `setupLifi`.
//
// Using `setupLifi()` (not raw `createClient`) keeps config.ts as the
// single source of truth for integrator/apiUrl + the active SDK client.
const ensureLifiConfiguredInRN = memoize(() => {
  setupLifi()
})

export const getLifiSwapQuote = async ({
  amount,
  affiliateBps,
  lifiAffiliateConfig,
  ...transfer
}: Input): Promise<GeneralSwapQuote> => {
  ensureLifiConfiguredInRN()

  const combinedCostBps = (affiliateBps ?? 0) + DEFAULT_LIFI_SLIPPAGE_TOLERANCE * 10000
  if (combinedCostBps > MAX_COMBINED_COST_BPS) {
    console.warn(
      `[getLifiSwapQuote] affiliate + slippage combined cost exceeds ${MAX_COMBINED_COST_BPS}bps: ${combinedCostBps}bps`
    )
  }

  const { getQuote } = await import('@lifi/sdk')

  // v4: actions take the SDK client as their first arg. The client is created
  // inside `setupLifi()` (run via `ensureLifiConfiguredInRN()` above), so
  // `getLifiClient()` is guaranteed initialised by the time we reach here.
  const lifiClient = getLifiClient()

  const [fromChain, toChain] = [transfer.from, transfer.to].map(({ chain }) => lifiSwapChainId[chain])

  const [fromToken, toToken] = [transfer.from, transfer.to].map(({ id, chain }) => id ?? chainFeeCoin[chain].ticker)
  const [fromAddress, toAddress] = [transfer.from, transfer.to].map(({ address }) => address)

  // Mirror core's per-call integrator override (Ehsan-saradar #618 review):
  // when the consumer supplied a `lifiAffiliateConfig` via
  // `SwapAffiliateConfig.lifi`, tag this quote with their portal integrator
  // instead of whatever sits in `lifiConfig.integratorName` (vultisig-0 by
  // default; consumer's value if they ran `setupLifi(bootstrap)` at boot).
  const integrator = lifiAffiliateConfig?.integratorName ?? lifiConfig.integratorName

  const quote = await getQuote(lifiClient, {
    fromChain,
    toChain,
    fromToken,
    toToken,
    fromAmount: amount.toString(),
    fromAddress,
    toAddress,
    // NeOMakinG #618 r2 should-fix mirror: explicit `undefined` only when
    // affiliateBps is genuinely unset. `affiliateBps: 0` previously fell into
    // the truthy-test and became `undefined`, which let LiFi's getQuote
    // silently fall back to `_config.routeOptions?.fee`. For a consumer that
    // explicitly set 0, that's a silent non-zero fee. Now: 0 stays 0.
    fee: affiliateBps !== undefined ? affiliateBps / 10000 : undefined,
    slippage: DEFAULT_LIFI_SLIPPAGE_TOLERANCE,
    integrator,
  })

  const { transactionRequest, estimate } = quote

  const chainKind = getChainKind(transfer.from.chain)

  const { value, gasLimit, data, from, to } = shouldBePresent(transactionRequest)

  // For Solana SPL-token swaps the destination ATA may not yet exist. LiFi's
  // transaction blob won't include the creation instruction in that case, which
  // causes the simulation to revert with custom program error 0x17.
  if (chainKind === 'solana' && toToken !== chainFeeCoin[transfer.to.chain].ticker) {
    const rawData = shouldBePresent(data)
    const { gasCosts, feeCosts } = estimate
    const [networkFee] = shouldBePresent(gasCosts)
    const fees = shouldBePresent(feeCosts)
    const swapFee = shouldBePresent(fees.find(fee => fee.name === 'LIFI Fixed Fee') || fees[0])
    const swapFeeAssetId =
      [fromToken, toToken].find(token => token === swapFee.token.address) || chainFeeCoin[transfer.from.chain].id

    const { data: patchedData, ataInjected } = await injectSolanaAtaIfMissing(rawData, toToken, toAddress, fromAddress)

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
        // Mirror the core implementation's EVM affiliate-fee extraction so RN
        // routes surface the same swap-fee row context as desktop/web. LI.FI's
        // `feeCosts` is the same shape across both kinds; keep `affiliateFee`
        // optional because not every route has one (affiliateBps may be 0 and
        // no LIFI Fixed Fee charged). See core for the full rationale on the
        // lowercase address normalization. (CodeRabbit #540 actionable.)
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
