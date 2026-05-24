import { createConfig, getQuote } from '@lifi/sdk'
import { DeriveChainKind, getChainKind } from '@vultisig/core-chain/ChainKind'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { lifiConfig } from '@vultisig/core-chain/swap/general/lifi/config'
import { lifiSwapChainId, LifiSwapEnabledChain } from '@vultisig/core-chain/swap/general/lifi/LifiSwapEnabledChains'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'
import { match } from '@vultisig/lib-utils/match'
import { memoize } from '@vultisig/lib-utils/memoize'
import { mirrorRecord } from '@vultisig/lib-utils/record/mirrorRecord'
import { TransferDirection } from '@vultisig/lib-utils/TransferDirection'

import { AccountCoinKey } from '../../../../coin/AccountCoin'
import { GeneralSwapQuote } from '../../GeneralSwapQuote'

type Input = Record<TransferDirection, AccountCoinKey<LifiSwapEnabledChain>> & {
  amount: bigint
  affiliateBps?: number
}

const setupLifi = memoize(() => {
  createConfig({
    integrator: lifiConfig.integratorName,
  })
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
const DEFAULT_LIFI_SLIPPAGE_TOLERANCE = 0.01

// Combined affiliate + slippage ceiling. Defensive guard so a high
// affiliateBps + the 1% slippage don't silently combine into a >3%
// effective cost on the user without anyone noticing. Logged-only,
// not a hard reject — getQuote will still dispatch. NeOMakinG #513
// round 1 `suggestion` 1.
const MAX_COMBINED_COST_BPS = 300

export const getLifiSwapQuote = async ({ amount, affiliateBps, ...transfer }: Input): Promise<GeneralSwapQuote> => {
  setupLifi()

  const [fromChain, toChain] = [transfer.from, transfer.to].map(({ chain }) => lifiSwapChainId[chain])

  const [fromToken, toToken] = [transfer.from, transfer.to].map(({ id, chain }) => id ?? chainFeeCoin[chain].ticker)
  const [fromAddress, toAddress] = [transfer.from, transfer.to].map(({ address }) => address)

  // Defensive: log when affiliate + slippage combined cost crosses the
  // 3% ceiling. Today affiliateBps is typically 0 and slippage is 1%,
  // so 100bps total — well under the ceiling — but a future bump to
  // affiliateBps shouldn't silently combine into a >3% effective cost
  // on the user without anyone noticing. NeOMakinG #513 r1.
  const combinedCostBps = (affiliateBps ?? 0) + DEFAULT_LIFI_SLIPPAGE_TOLERANCE * 10000
  if (combinedCostBps > MAX_COMBINED_COST_BPS) {
    console.warn(
      `[getLifiSwapQuote] affiliate + slippage combined cost exceeds ${MAX_COMBINED_COST_BPS}bps: ${combinedCostBps}bps`
    )
  }

  const quote = await getQuote({
    fromChain,
    toChain,
    fromToken,
    toToken,
    fromAmount: amount.toString(),
    fromAddress,
    toAddress,
    fee: affiliateBps ? affiliateBps / 10000 : undefined,
    slippage: DEFAULT_LIFI_SLIPPAGE_TOLERANCE,
  })

  const { transactionRequest, estimate } = quote

  const chainKind = getChainKind(transfer.from.chain)

  const { value, gasLimit, data, from, to } = shouldBePresent(transactionRequest)

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
              chain: mirrorRecord(lifiSwapChainId)[swapFee.token.chainId],
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
        const swapFeeAssetId =
          swapFee &&
          ([fromToken, toToken].find(token => token === swapFee.token.address) ||
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
                    chain: mirrorRecord(lifiSwapChainId)[swapFee.token.chainId],
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
