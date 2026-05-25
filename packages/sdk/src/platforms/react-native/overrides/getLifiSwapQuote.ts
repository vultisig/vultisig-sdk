// RN override for `@vultisig/core-chain/swap/general/lifi/api/getLifiSwapQuote`.
//
// `@lifi/sdk`'s barrel statically evaluates `@wallet-standard/app`, which
// declares `class AppReadyEvent extends Event` at module top-level. Hermes
// ships without the `Event` / `EventTarget` DOM globals; even with the
// `event-target-polyfill` installed in the RN entry, it only takes effect
// *after* the entry's polyfill import runs. Since `@lifi/sdk` is an
// external module in the RN bundle, metro would resolve it and evaluate
// its module body *before* the bundle body — racing against the polyfill.
//
// This override reaches `@lifi/sdk` via `await import()` inside the async
// body so the module never evaluates unless a swap quote is actually
// requested, by which point the polyfills are fully in place.
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
import { lifiConfig } from '@vultisig/core-chain/swap/general/lifi/config'
import { lifiSwapChainId, LifiSwapEnabledChain } from '@vultisig/core-chain/swap/general/lifi/LifiSwapEnabledChains'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'
import { match } from '@vultisig/lib-utils/match'
import { memoize } from '@vultisig/lib-utils/memoize'
import { mirrorRecord } from '@vultisig/lib-utils/record/mirrorRecord'
import { TransferDirection } from '@vultisig/lib-utils/TransferDirection'

type Input = Record<TransferDirection, AccountCoinKey<LifiSwapEnabledChain>> & {
  amount: bigint
  affiliateBps?: number
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

const setupLifi = memoize(async () => {
  const { createConfig } = await import('@lifi/sdk')
  createConfig({
    integrator: lifiConfig.integratorName,
  })
})

export const getLifiSwapQuote = async ({ amount, affiliateBps, ...transfer }: Input): Promise<GeneralSwapQuote> => {
  await setupLifi()

  const combinedCostBps = (affiliateBps ?? 0) + DEFAULT_LIFI_SLIPPAGE_TOLERANCE * 10000
  if (combinedCostBps > MAX_COMBINED_COST_BPS) {
    console.warn(
      `[getLifiSwapQuote] affiliate + slippage combined cost exceeds ${MAX_COMBINED_COST_BPS}bps: ${combinedCostBps}bps`
    )
  }

  const { getQuote } = await import('@lifi/sdk')

  const [fromChain, toChain] = [transfer.from, transfer.to].map(({ chain }) => lifiSwapChainId[chain])

  const [fromToken, toToken] = [transfer.from, transfer.to].map(({ id, chain }) => id ?? chainFeeCoin[chain].ticker)
  const [fromAddress, toAddress] = [transfer.from, transfer.to].map(({ address }) => address)

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
        return {
          evm: {
            from: shouldBePresent(from),
            to: shouldBePresent(to),
            data: shouldBePresent(data),
            value: BigInt(shouldBePresent(value)).toString(),
            gasLimit: gasLimit ? BigInt(gasLimit) : undefined,
          },
        }
      },
    }),
  }
}
