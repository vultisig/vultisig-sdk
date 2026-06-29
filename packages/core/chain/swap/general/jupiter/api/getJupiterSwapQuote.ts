import { Chain } from '@vultisig/core-chain/Chain'
import { solanaConfig } from '@vultisig/core-chain/chains/solana/solanaConfig'
import { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import { GeneralSwapQuote } from '@vultisig/core-chain/swap/general/GeneralSwapQuote'
import { getJupiterConfig, jupiterFeeOwnerAddress } from '@vultisig/core-chain/swap/general/jupiter/config'
import { JupiterSwapEnabledChain } from '@vultisig/core-chain/swap/general/jupiter/JupiterSwapEnabledChains'
import { TransferDirection } from '@vultisig/lib-utils/TransferDirection'

import { deriveJupiterFeeAccount, prependJupiterFeeAta } from './jupiterFeeAta'

/** Canonical wrapped-SOL mint, used as the mint address for native SOL legs. */
const solanaNativeMint = 'So11111111111111111111111111111111111111112'

/** Jupiter default slippage when the caller does not override (bps). */
const DEFAULT_JUPITER_SLIPPAGE_BPS = 50

type Input = Record<TransferDirection, AccountCoin<JupiterSwapEnabledChain>> & {
  amount: bigint
  /** VULT-scaled affiliate fee in bps. `0` disables the platform fee entirely. */
  affiliateBps?: number
  /** Slippage tolerance in bps (e.g. 50 = 0.5%). Defaults to 50. */
  slippageBps?: number
}

type JupiterPlatformFee = {
  amount?: string
  feeBps?: number
}

type JupiterQuoteResponse = {
  inputMint: string
  inAmount: string
  outputMint: string
  outAmount: string
  otherAmountThreshold?: string
  swapMode?: string
  slippageBps?: number
  priceImpactPct?: string
  platformFee?: JupiterPlatformFee | null
  routePlan?: unknown[]
}

type JupiterSwapResponse = {
  swapTransaction?: string
  lastValidBlockHeight?: number
}

const mintFor = ({ id }: AccountCoin): string => id ?? solanaNativeMint

const requestJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, init)
  const rawText = await response.text().catch(() => '')

  if (!response.ok) {
    const hint = rawText ? ` ${rawText.slice(0, 200)}` : ''
    throw new Error(`Jupiter request failed (${response.status}): ${response.statusText}${hint}`)
  }

  try {
    return JSON.parse(rawText) as T
  } catch {
    throw new Error('Jupiter returned a non-JSON response.')
  }
}

/**
 * Fetch a Solana same-chain swap quote from Jupiter and build the signed-tx
 * payload the keysign pipeline expects.
 *
 * Affiliate fee: when `affiliateBps > 0`, `platformFeeBps` is sent on the quote.
 * The fee ATA (output mint, owner = `jupiterFeeOwnerAddress`) is derived, passed
 * to `/swap` as `feeAccount`, and an idempotent create instruction is prepended
 * to the returned transaction only when the quote actually returns a non-zero
 * `platformFee.amount`. When `affiliateBps` is 0 (e.g. an Ultimate-tier VULT
 * holder) or Jupiter floors the fee to zero, no fee account is touched.
 */
export const getJupiterSwapQuote = async ({
  from,
  to,
  amount,
  affiliateBps = 0,
  slippageBps = DEFAULT_JUPITER_SLIPPAGE_BPS,
}: Input): Promise<GeneralSwapQuote> => {
  const { baseUrl } = getJupiterConfig()

  const inputMint = mintFor(from)
  const outputMint = mintFor(to)

  const requestsPlatformFee = affiliateBps > 0

  const quoteParams = new URLSearchParams({
    swapMode: 'ExactIn',
    inputMint,
    outputMint,
    amount: amount.toString(),
    slippageBps: slippageBps.toString(),
  })
  if (requestsPlatformFee) {
    quoteParams.set('platformFeeBps', affiliateBps.toString())
  }

  const quoteResponse = await requestJson<JupiterQuoteResponse>(`${baseUrl}/swap/v1/quote?${quoteParams.toString()}`, {
    headers: { Accept: 'application/json' },
  })

  // Gate the fee-account flow on the actually quoted fee, not just the requested
  // bps: Jupiter can floor `platformFee.amount` to 0 (tiny amounts, route with no
  // fee-eligible mint) even when we asked for a fee. Deriving a fee account and
  // paying ATA rent for a zero fee would break the "no fee account when the fee
  // floors to zero" contract. Require both a requested fee and a non-zero quoted
  // amount before touching the fee account.
  const swapFeeAmount = BigInt(quoteResponse.platformFee?.amount ?? '0')
  const chargesFee = requestsPlatformFee && swapFeeAmount > 0n

  // The fee mint is the OUTPUT mint (ExactIn). Derive the fee ATA up front so
  // it can be sent to /swap and so we know which program owns it for the
  // prepended create instruction.
  const feeAccountInfo = chargesFee
    ? await deriveJupiterFeeAccount({ outputMint, feeOwner: jupiterFeeOwnerAddress })
    : undefined

  const swapResponse = await requestJson<JupiterSwapResponse>(`${baseUrl}/swap/v1/swap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      quoteResponse,
      userPublicKey: from.address,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      ...(feeAccountInfo ? { feeAccount: feeAccountInfo.feeAccount } : {}),
    }),
  })

  if (!swapResponse.swapTransaction) {
    throw new Error('Jupiter swap response did not include a serialized transaction.')
  }

  const data = feeAccountInfo
    ? await prependJupiterFeeAta({
        txData: swapResponse.swapTransaction,
        feeAccount: feeAccountInfo.feeAccount,
        mintPubkey: feeAccountInfo.mintPubkey,
        ownerPubkey: feeAccountInfo.ownerPubkey,
        tokenProgramId: feeAccountInfo.tokenProgramId,
      })
    : swapResponse.swapTransaction

  // Network fee is an upper-bound estimate: Solana's per-signature base fee plus
  // the fee-ATA rent buffer when we prepend a create instruction (charged once
  // per fee mint; idempotent thereafter). Jupiter embeds its own priority fee in
  // the returned tx, which the consumer surfaces at broadcast time.
  const networkFee = BigInt(solanaConfig.baseFee) + (chargesFee ? BigInt(solanaConfig.ataRentLamports) : 0n)

  return {
    dstAmount: quoteResponse.outAmount,
    provider: 'jupiter',
    tx: {
      solana: {
        data,
        networkFee,
        swapFee: {
          amount: swapFeeAmount,
          decimals: to.decimals,
          chain: Chain.Solana,
          id: to.id,
        },
      },
    },
  }
}
