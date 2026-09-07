import { SwapFee } from '@vultisig/core-chain/swap/SwapFee'

import { CowSwapTokenBalance } from './cowswap/sign/buildCowSwapOrder'
import { CowSwapOrderKind } from './cowswap/types'
import { GeneralSwapProvider } from './GeneralSwapProvider'

export type GeneralSwapTx =
  | {
      evm: {
        from: string
        to: string
        data: string
        value: string
        gasLimit?: bigint
        affiliateFee?: SwapFee
        /**
         * The address that will be called as `transferFrom` spender for the
         * input ERC-20 token. Set by LI.FI quotes from `estimate.approvalAddress`
         * when it differs from `to` (e.g. when 1inch or another inner executor
         * does the token pull directly instead of the Diamond/router).
         *
         * On-chain proof of the gap: tx 0xa3aadf17 (Ethereum, block 25415989)
         * reverted with "ERC20: transfer amount exceeds allowance" because the
         * vault had 9.41 USDC approved to the Diamond (`to` = 0x9025B8ff…) but
         * zero allowance to the 1inch executor (`approvalAddress`). The Diamond
         * being approved is not sufficient when an inner executor does the pull.
         *
         * Consumers building an ERC-20 approve leg MUST use this field as the
         * spender when present, falling back to `to` only when absent.
         */
        approvalAddress?: string
      }
    }
  | {
      solana: {
        data: string
        networkFee: bigint
        swapFee: SwapFee
      }
    }
  | {
      transfer: {
        to: string
        amount: bigint
        memo?: string
        txType?: string
        txPayload?: Uint8Array
        inboundAddress?: string
        swapId?: string
        /**
         * Provider fee for the route, when the response itemizes one. Absent
         * rather than zero when no fee is itemized or its shape can't be
         * resolved — the same convention `evm.affiliateFee` follows, since
         * neither establishes an amount worth vouching for.
         *
         * Not part of the signed transfer. It travels so a cosigning peer,
         * which holds no quote, can state what the swap costs.
         */
        swapFee?: SwapFee
      }
    }
  | {
      cowswap_order: {
        sellToken: string
        buyToken: string
        receiver: string
        sellAmount: string
        buyAmount: string
        validTo: number
        appData: string
        appDataHash: string
        feeAmount: string
        kind: CowSwapOrderKind
        partiallyFillable: boolean
        sellTokenBalance: CowSwapTokenBalance
        buyTokenBalance: CowSwapTokenBalance
        chainId: number
        apiBase: string
        /** Set to true when the sellToken supports EIP-2612 permit. When true
         * the signing flow should build and include a permit signature alongside
         * the order signature, avoiding a separate ERC-20 approve transaction. */
        permitRequired?: true
      }
    }
  | {
      cosmosWasm: {
        sender: string
        contract: string
        executeMsg: string
        funds: Array<{ denom: string; amount: string }>
      }
    }

/**
 * Quote returned by a general-purpose swap provider.
 *
 * Consumers building a "View on Explorer" link should call
 * `getSwapExplorerUrl({ provider, txHash, fromChain })` from
 * `@vultisig/core-chain/swap/utils/getSwapExplorerUrl` instead of routing
 * by hand — the helper covers LI.FI / Helius and SwapKit scanners, accepts the
 * provider-specific CoW order UID for pending CowSwap orders, and falls back to
 * the source-chain explorer for `1inch` / `jupiter` / `kyber`.
 */
export type GeneralSwapQuote = {
  dstAmount: string
  provider: GeneralSwapProvider
  routeProvider?: string
  /** Absolute provider quote expiry in milliseconds, when supplied. */
  expiresAt?: number
  /**
   * Signed price impact of the route as a FRACTION, not a percent: `0.0133`
   * means 1.33% of output lost, and a negative value is a favorable trade.
   *
   * Do NOT hand this to `evaluatePriceImpactPercent` — it takes a percent, so
   * `0.45` would be read as 0.45% rather than 45% and pass a ceiling it should
   * fail. Scale it first (`fraction * 100`), or use
   * `evaluateImpactFromFractionString` when the raw string is still in hand.
   *
   * Absent whenever no usable figure was found, not as a property of the
   * provider: today only SwapKit routes populate it, from `meta.priceImpact`
   * with a `totalSlippageBps` fallback, and even those omit it when neither is
   * a finite number. Consumers hide the row rather than substitute anything
   * for it.
   */
  priceImpactFraction?: number
  tx: GeneralSwapTx
}
