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
import { logUnenforcedAggregatorDestination } from '../../knownAggregatorRouters'
import { injectSolanaAtaIfMissing } from './injectSolanaAtaIfMissing'
import { MAX_COMBINED_COST_BPS, resolveLifiSlippage } from './lifiSlippage'

type Input = Record<TransferDirection, AccountCoinKey<LifiSwapEnabledChain> & { ticker?: string }> & {
  amount: bigint
  affiliateBps?: number
  /** Consumer-supplied LI.FI integrator override. When omitted, falls back
   * to the global `lifiConfig.integratorName` (vultisig-0 by default). */
  lifiAffiliateConfig?: LifiAffiliateConfig
  /** Slippage tolerance as a fraction (e.g. 0.01 = 1%). When omitted, falls
   * back to the stable/non-stable pair default. */
  slippage?: number
}

/** @internal re-exported for unit tests only — source of truth is ./lifiSlippage. */
export { isStablePair, STABLE_TICKERS } from './lifiSlippage'

/** Lazy bootstrap for callers that never invoked the public `setupLifi`
 * — uses whatever defaults sit on `lifiConfig` (vultisig-0 + no apiUrl
 * unless a consumer mutated them at module load). The public `setupLifi`
 * exported from ../config is idempotent and short-circuits subsequent
 * calls, so this is safe to call on every quote. */
const ensureLifiConfigured = memoize(() => {
  setupLifi()
})

// Slippage tolerance (baked into the LiFi-prebuilt tx's minAmountOut floor) is resolved by
// ./lifiSlippage — the shared source of truth for the two tiers + combined-cost ceiling, so the RN
// override resolves it identically. See that module for the full rationale (MPC ceremony drift, the
// stable/volatile split, and the cross-chain bridge-slippage caveat).

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
  slippage: slippageOverride,
  ...transfer
}: Input): Promise<GeneralSwapQuote> => {
  ensureLifiConfigured()

  const [fromChain, toChain] = [transfer.from, transfer.to].map(({ chain }) => lifiSwapChainId[chain])

  const [fromToken, toToken] = [transfer.from, transfer.to].map(({ id, chain }) => id ?? chainFeeCoin[chain].ticker)
  const [fromAddress, toAddress] = [transfer.from, transfer.to].map(({ address }) => address)

  const slippage = resolveLifiSlippage({ slippageOverride, from: transfer.from, to: transfer.to })

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
        // LI.FI `estimate.approvalAddress` is the address that will call
        // `transferFrom` on the input ERC-20. It can differ from `to` (the
        // Diamond / router) when an inner executor (e.g. 1inch
        // AggregationExecutor) pulls the token directly. The field is always
        // present in the LiFi API response (`Estimate.approvalAddress: string`)
        // but may be the zero address or equal to `to` for native-token routes.
        // Pass it through so mcp-ts (and other consumers) can approve the
        // correct spender instead of the Diamond.
        //
        // On-chain proof: tx 0xa3aadf17 (Ethereum, block 25415989) reverted
        // with "ERC20: transfer amount exceeds allowance". Vault had 9.41 USDC
        // approved to Diamond (0x9025B8ff…, = `to`) — sufficient. Inner 1inch
        // executor (0x7f51c134…, = `approvalAddress`) had zero allowance — the
        // actual transferFrom caller → revert.
        const approvalAddr = estimate.approvalAddress
        const evmTo = shouldBePresent(to)
        // AGG-02: LiFi routes through many different bridge/DEX contracts by design
        // (diamond routing, multi-hop, chain-specific deployments) — a hard allowlist
        // would false-block legitimate routes, so log (never throw). See
        // knownAggregatorRouters.ts.
        logUnenforcedAggregatorDestination('li.fi', evmTo)
        return {
          evm: {
            from: shouldBePresent(from),
            to: evmTo,
            data: shouldBePresent(data),
            value: BigInt(shouldBePresent(value)).toString(),
            gasLimit: gasLimit ? BigInt(gasLimit) : undefined,
            // Include approvalAddress when it is present and non-zero so the
            // consumer can approve the right spender. Omit for the zero address
            // (native-only routes) to avoid a spurious zero-address approval.
            ...(approvalAddr && approvalAddr !== '0x0000000000000000000000000000000000000000'
              ? { approvalAddress: approvalAddr }
              : {}),
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
