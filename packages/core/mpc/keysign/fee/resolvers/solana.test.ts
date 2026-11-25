import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import lifiSwapFixtures from '@vultisig/core-chain/fixtures/lifi-solana-swap-transactions.json'
import {
  OneInchQuoteSchema,
  OneInchSwapPayloadSchema,
  OneInchTransactionSchema,
} from '@vultisig/core-mpc/types/vultisig/keysign/v1/1inch_swap_payload_pb'
import { CoinSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/coin_pb'
import { KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { SolanaSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getSolanaFeeAmount } from './solana'

const getSolanaTokenAccountRent = vi.hoisted(() => vi.fn())

vi.mock('@vultisig/core-chain/chains/solana/tokenAccountRent', () => ({
  getSolanaTokenAccountRent,
}))

// Mainnet getMinimumBalanceForRentExemption(165), 2026-11-25.
const LIVE_ATA_RENT = 1_488_440n

const SENDER = '2rMJcuWtp29QSMNKZucumuznhq9gMPBvw98ZcGDfnJxa'
const RECEIVER = 'GogodXVKU6KfeZiSR9oybanGGZXRuQ34ogb2i3f3WvYi'
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const FROM_ATA = '7uQp24mcoUe9MxPCabwq8b13mFrjVXfh2ZvYqsVYKkpd'
const TO_ATA = '4XqMxvLmUMxR1L6r7XZ5GnWy3Pna7BUuzrcLvm5Twr2T'

const buildInput = ({
  contractAddress,
  fromTokenAssociatedAddress,
  toTokenAssociatedAddress,
  priorityFee,
}: {
  contractAddress?: string
  fromTokenAssociatedAddress?: string
  toTokenAssociatedAddress?: string
  priorityFee: string
}) => {
  const solanaSpecific = create(SolanaSpecificSchema, {
    recentBlockHash: '44jzmJEahEFTHexSNLkLfXXXyKggtpT2jJuJ3hdCBbsB',
    priorityFee,
    computeLimit: '100000',
  })
  if (fromTokenAssociatedAddress) {
    solanaSpecific.fromTokenAssociatedAddress = fromTokenAssociatedAddress
  }
  if (toTokenAssociatedAddress) {
    solanaSpecific.toTokenAssociatedAddress = toTokenAssociatedAddress
  }
  return {
    keysignPayload: create(KeysignPayloadSchema, {
      coin: create(CoinSchema, {
        chain: Chain.Solana,
        ticker: contractAddress ? 'USDC' : 'SOL',
        address: SENDER,
        decimals: 6,
        contractAddress: contractAddress ?? '',
        isNativeToken: !contractAddress,
      }),
      toAddress: RECEIVER,
      toAmount: '1000000',
      blockchainSpecific: { case: 'solanaSpecific' as const, value: solanaSpecific },
    }),
    walletCore: {} as never,
    publicKey: {} as never,
  }
}

describe('getSolanaFeeAmount', () => {
  beforeEach(() => {
    getSolanaTokenAccountRent.mockReset().mockResolvedValue(LIVE_ATA_RENT)
  })

  it('computes baseFee + priorityFeeAmount for native SOL', async () => {
    // priorityFeeAmount = 1_000_000 µLam/CU * 100_000 CU / 1_000_000 = 100_000 lamports
    // total = 5000 baseFee + 100_000 priority = 105_000
    expect(await getSolanaFeeAmount(buildInput({ priorityFee: '1000000' }))).toBe(105_000n)
    expect(getSolanaTokenAccountRent).not.toHaveBeenCalled()
  })

  it('scales priorityFeeAmount with the price', async () => {
    // 5_000_000 * 100_000 / 1_000_000 = 500_000 priority + 5000 base = 505_000
    expect(await getSolanaFeeAmount(buildInput({ priorityFee: '5000000' }))).toBe(505_000n)
  })

  // Mainnet charges 128_457 lamports for this message (getFeeForMessage): the
  // runtime rounds 123_456.7 up, so a floored quote leaves a MAX send short.
  it('rounds a fractional priorityFeeAmount up to a whole lamport, as the runtime does', async () => {
    expect(await getSolanaFeeAmount(buildInput({ priorityFee: '1234567' }))).toBe(128_457n)
  })

  it('adds the live ATA rent for SPL transfers when recipient ATA is missing', async () => {
    // base 5000 + live ataRent 1_488_440 + priority 100_000 = 1_593_440
    expect(
      await getSolanaFeeAmount(
        buildInput({
          contractAddress: USDC_MINT,
          fromTokenAssociatedAddress: FROM_ATA,
          priorityFee: '1000000',
        })
      )
    ).toBe(1_593_440n)
    expect(getSolanaTokenAccountRent).toHaveBeenCalledOnce()
  })

  it('skips ATA rent when recipient ATA is present', async () => {
    expect(
      await getSolanaFeeAmount(
        buildInput({
          contractAddress: USDC_MINT,
          fromTokenAssociatedAddress: FROM_ATA,
          toTokenAssociatedAddress: TO_ATA,
          priorityFee: '1000000',
        })
      )
    ).toBe(105_000n)
    expect(getSolanaTokenAccountRent).not.toHaveBeenCalled()
  })

  describe('aggregator swap', () => {
    const withSwapTransaction = (input: ReturnType<typeof buildInput>, data: string) => {
      input.keysignPayload.swapPayload = {
        case: 'oneinchSwapPayload',
        value: create(OneInchSwapPayloadSchema, {
          quote: create(OneInchQuoteSchema, { tx: create(OneInchTransactionSchema, { data }) }),
        }),
      }
      return input
    }

    it("charges what the provider transaction's compute budget sets, not the chain-specific priority fee", async () => {
      const input = withSwapTransaction(
        buildInput({ priorityFee: '1000000' }),
        lifiSwapFixtures.solToUsdc.swapTransaction
      )

      // getFeeForMessage on mainnet for this message; the chain-specific fields alone quote 105,000.
      expect(await getSolanaFeeAmount(input)).toBe(48_423n)
    })

    it('keeps the ATA rent term for a swap from a token', async () => {
      const input = withSwapTransaction(
        buildInput({ contractAddress: USDC_MINT, fromTokenAssociatedAddress: FROM_ATA, priorityFee: '1000000' }),
        lifiSwapFixtures.solToUsdc.swapTransaction
      )

      expect(await getSolanaFeeAmount(input)).toBe(48_423n + LIVE_ATA_RENT)
    })

    it('falls back to the chain-specific fields when the swap carries no transaction', async () => {
      const input = withSwapTransaction(buildInput({ priorityFee: '1000000' }), '')

      expect(await getSolanaFeeAmount(input)).toBe(105_000n)
    })
  })
})
