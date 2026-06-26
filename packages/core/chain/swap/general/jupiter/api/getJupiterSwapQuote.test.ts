import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { PublicKey } from '@solana/web3.js'
import { Chain } from '@vultisig/core-chain/Chain'
import { getSolanaClient } from '@vultisig/core-chain/chains/solana/client'
import { solanaConfig } from '@vultisig/core-chain/chains/solana/solanaConfig'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getJupiterSwapQuote, SOL_NATIVE_MINT } from './getJupiterSwapQuote'

vi.mock('@vultisig/core-chain/chains/solana/client', () => ({
  getSolanaClient: vi.fn(),
}))

const FEE_OWNER = '8iqhrtBzMcYLR6c6FkzeoMHibedYDkHvLKnX2ArNie5z'
const USER = '5QXePTiaWgmqSCHh9YDWAiVvEeKWaM5cUN62K4SXwUSB'
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const BASE_URL = 'https://jupiter.example'

const quoteResponse = {
  inputMint: SOL_NATIVE_MINT,
  inAmount: '100000000',
  outputMint: USDC_MINT,
  outAmount: '14230000',
  otherAmountThreshold: '14158850',
  swapMode: 'ExactIn',
  slippageBps: 50,
  platformFee: { amount: '71150', feeBps: 50 },
  priceImpactPct: '0',
  routePlan: [
    {
      swapInfo: {
        ammKey: 'whirlpool-key',
        label: 'Whirlpool',
        inputMint: SOL_NATIVE_MINT,
        outputMint: USDC_MINT,
        inAmount: '100000000',
        outAmount: '14230000',
        feeAmount: '4000',
        feeMint: SOL_NATIVE_MINT,
      },
      percent: 100,
    },
  ],
}

const buildSwapTransaction = async () => {
  const { Keypair, SystemProgram, TransactionMessage, VersionedTransaction } = await import('@solana/web3.js')
  const payer = new PublicKey(USER)
  const tx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: payer,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
      instructions: [
        SystemProgram.transfer({
          fromPubkey: payer,
          toPubkey: Keypair.generate().publicKey,
          lamports: 1,
        }),
      ],
    }).compileToV0Message()
  )
  return Buffer.from(tx.serialize()).toString('base64')
}

describe('getJupiterSwapQuote', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let swapTransaction: string

  beforeEach(async () => {
    swapTransaction = await buildSwapTransaction()
    fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = String(input)
      const body = url.includes('/quote') ? quoteResponse : { swapTransaction, prioritizationFeeLamports: 1234 }
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.mocked(getSolanaClient).mockReturnValue({
      getAccountInfo: vi
        .fn()
        .mockResolvedValueOnce({ owner: TOKEN_PROGRAM_ID, data: Buffer.alloc(82) })
        .mockResolvedValueOnce({ owner: TOKEN_PROGRAM_ID, data: Buffer.alloc(82) })
        .mockResolvedValueOnce(null),
      getAddressLookupTable: vi.fn().mockResolvedValue({ value: null }),
    } as any)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('builds a Jupiter Solana quote with platform fee and derived feeAccount', async () => {
    const quote = await getJupiterSwapQuote({
      from: {
        chain: Chain.Solana,
        address: USER,
        decimals: 9,
        ticker: 'SOL',
      },
      to: {
        chain: Chain.Solana,
        address: USER,
        id: USDC_MINT,
        decimals: 6,
        ticker: 'USDC',
      },
      amount: 100000000n,
      affiliateBps: 50,
      jupiterConfig: { feeOwner: FEE_OWNER, baseUrl: BASE_URL },
    })

    const quoteUrl = String(fetchMock.mock.calls[0][0])
    expect(quoteUrl).toContain(`${BASE_URL}/swap/v1/quote`)
    expect(quoteUrl).toContain(`inputMint=${SOL_NATIVE_MINT}`)
    expect(quoteUrl).toContain(`outputMint=${USDC_MINT}`)
    expect(quoteUrl).toContain('platformFeeBps=50')

    const swapBody = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)
    expect(swapBody.feeAccount).toBe(
      getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), new PublicKey(FEE_OWNER)).toBase58()
    )

    expect(quote.provider).toBe('jupiter')
    expect(quote.dstAmount).toBe('14230000')
    expect(quote.routeProvider).toBe('Whirlpool')
    expect('solana' in quote.tx).toBe(true)
    if (!('solana' in quote.tx)) {
      throw new Error('Expected Solana Jupiter transaction')
    }
    expect(quote.tx.solana.swapFee.amount).toBe(71150n)
    expect(quote.tx.solana.swapFee.id).toBe(USDC_MINT)
    expect(quote.tx.solana.networkFee).toBe(BigInt(solanaConfig.baseFee + solanaConfig.ataRentLamports + 1234))
  })

  it('derives the Jupiter feeAccount with the Token-2022 program when the output mint is Token-2022', async () => {
    vi.mocked(getSolanaClient).mockReturnValue({
      getAccountInfo: vi
        .fn()
        .mockResolvedValueOnce({ owner: TOKEN_2022_PROGRAM_ID, data: Buffer.alloc(82) })
        .mockResolvedValueOnce({ owner: TOKEN_2022_PROGRAM_ID, data: Buffer.alloc(82) })
        .mockResolvedValueOnce(null),
      getAddressLookupTable: vi.fn().mockResolvedValue({ value: null }),
    } as any)

    await getJupiterSwapQuote({
      from: {
        chain: Chain.Solana,
        address: USER,
        decimals: 9,
        ticker: 'SOL',
      },
      to: {
        chain: Chain.Solana,
        address: USER,
        id: USDC_MINT,
        decimals: 6,
        ticker: 'USDC',
      },
      amount: 100000000n,
      affiliateBps: 50,
      jupiterConfig: { feeOwner: FEE_OWNER, baseUrl: BASE_URL },
    })

    const swapBody = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)
    expect(swapBody.feeAccount).toBe(
      getAssociatedTokenAddressSync(
        new PublicKey(USDC_MINT),
        new PublicKey(FEE_OWNER),
        false,
        TOKEN_2022_PROGRAM_ID
      ).toBase58()
    )
  })

  it('omits Jupiter platform fee params and ATA creation when affiliate bps is zero', async () => {
    fetchMock.mockImplementation(async (input: string | URL | Request) => {
      const url = String(input)
      const body = url.includes('/quote')
        ? { ...quoteResponse, platformFee: undefined }
        : { swapTransaction, prioritizationFeeLamports: 1234 }
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    vi.mocked(getSolanaClient).mockClear()

    const quote = await getJupiterSwapQuote({
      from: {
        chain: Chain.Solana,
        address: USER,
        decimals: 9,
        ticker: 'SOL',
      },
      to: {
        chain: Chain.Solana,
        address: USER,
        id: USDC_MINT,
        decimals: 6,
        ticker: 'USDC',
      },
      amount: 100000000n,
      affiliateBps: 0,
      jupiterConfig: { feeOwner: FEE_OWNER, baseUrl: BASE_URL },
    })

    const quoteUrl = String(fetchMock.mock.calls[0][0])
    expect(quoteUrl).not.toContain('platformFeeBps')

    const swapBody = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)
    expect(swapBody.feeAccount).toBeUndefined()
    expect(getSolanaClient).not.toHaveBeenCalled()

    expect('solana' in quote.tx).toBe(true)
    if (!('solana' in quote.tx)) {
      throw new Error('Expected Solana Jupiter transaction')
    }
    expect(quote.tx.solana.data).toBe(swapTransaction)
    expect(quote.tx.solana.swapFee.amount).toBe(0n)
    expect(quote.tx.solana.networkFee).toBe(BigInt(solanaConfig.baseFee + 1234))
  })

  it('does not add ATA rent when the Jupiter fee account already exists', async () => {
    vi.mocked(getSolanaClient).mockReturnValue({
      getAccountInfo: vi
        .fn()
        .mockResolvedValueOnce({ owner: TOKEN_PROGRAM_ID, data: Buffer.alloc(82) })
        .mockResolvedValueOnce({ owner: TOKEN_PROGRAM_ID, data: Buffer.alloc(82) })
        .mockResolvedValueOnce({ owner: TOKEN_PROGRAM_ID, data: Buffer.alloc(165) }),
      getAddressLookupTable: vi.fn().mockResolvedValue({ value: null }),
    } as any)

    const quote = await getJupiterSwapQuote({
      from: {
        chain: Chain.Solana,
        address: USER,
        decimals: 9,
        ticker: 'SOL',
      },
      to: {
        chain: Chain.Solana,
        address: USER,
        id: USDC_MINT,
        decimals: 6,
        ticker: 'USDC',
      },
      amount: 100000000n,
      affiliateBps: 50,
      jupiterConfig: { feeOwner: FEE_OWNER, baseUrl: BASE_URL },
    })

    expect('solana' in quote.tx).toBe(true)
    if (!('solana' in quote.tx)) {
      throw new Error('Expected Solana Jupiter transaction')
    }
    expect(quote.tx.solana.data).toBe(swapTransaction)
    expect(quote.tx.solana.networkFee).toBe(BigInt(solanaConfig.baseFee + 1234))
  })
})
