import { PublicKey } from '@solana/web3.js'
import { assertSafeSolanaSwapTransactionBase64 } from '@vultisig/core-chain/chains/solana/assertSafeSolanaSwapInstructions'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const deriveJupiterFeeAccountMock = vi.hoisted(() => vi.fn())
const prependJupiterFeeAtaMock = vi.hoisted(() => vi.fn())

vi.mock('@vultisig/core-chain/swap/general/jupiter/api/jupiterFeeAta', () => ({
  deriveJupiterFeeAccount: (...args: unknown[]) => deriveJupiterFeeAccountMock(...args),
  prependJupiterFeeAta: (...args: unknown[]) => prependJupiterFeeAtaMock(...args),
}))

import {
  buildJupiterSwapTx,
  JUPITER_AFFILIATE_FEE_OWNER,
  JUPITER_PLATFORM_FEE_BPS,
  PriceImpactTooHighError,
  resolveJupiterFeeAccount,
  SOL_NATIVE_MINT,
} from '../../src/tools/swap/jupiter'

// The instruction-allowlist guard (audit finding SOL-01) is covered by its
// own dedicated test suite against real captured Jupiter fixtures
// (assertSafeSolanaSwapInstructions.test.ts in core-chain). Here it's mocked
// so this file's fake `swapTransaction` strings don't need to be valid
// VersionedTransaction bytes.
vi.mock('@vultisig/core-chain/chains/solana/assertSafeSolanaSwapInstructions', () => ({
  assertSafeSolanaSwapTransactionBase64: vi.fn(),
}))

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const USER = '5QXePTiaWgmqSCHh9YDWAiVvEeKWaM5cUN62K4SXwUSB'
const FAKE_ATA = 'CRz7ucCE6ZFhN297AC56ihUBbdDuZNzN3D7MVw2cYPna'
const fakeFeeAccountInfo = {
  feeAccount: FAKE_ATA,
  mintPubkey: {} as never,
  ownerPubkey: {} as never,
  tokenProgramId: {} as never,
}

const fakeQuote = {
  inputMint: SOL_NATIVE_MINT,
  inAmount: '100000000',
  outputMint: USDC_MINT,
  outAmount: '14230000',
  otherAmountThreshold: '14087700',
  platformFee: { amount: '7100', feeBps: JUPITER_PLATFORM_FEE_BPS },
  swapMode: 'ExactIn',
  slippageBps: 100,
  priceImpactPct: '0.0011',
  routePlan: [
    {
      swapInfo: {
        ammKey: 'whirlpoolKey',
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

const fakeSwap = { swapTransaction: 'BASE64_UNSIGNED_TX==' }

describe('resolveJupiterFeeAccount', () => {
  beforeEach(() => {
    deriveJupiterFeeAccountMock.mockReset().mockResolvedValue(fakeFeeAccountInfo)
  })

  it('derives the treasury ATA for the output mint', async () => {
    await expect(resolveJupiterFeeAccount(USDC_MINT)).resolves.toBe(fakeFeeAccountInfo)
    expect(deriveJupiterFeeAccountMock).toHaveBeenCalledWith({
      outputMint: USDC_MINT,
      feeOwner: JUPITER_AFFILIATE_FEE_OWNER,
    })
  })

  it('exposes the treasury owner and bps as source-of-truth constants', () => {
    // SOL-03: standardized on the shared cross-platform spec address (matches
    // iOS/Android/the SDK's own general-swap Jupiter config), not the earlier
    // ad-hoc '5QXePTia...' address this test previously asserted.
    expect(JUPITER_AFFILIATE_FEE_OWNER).toBe('8iqhrtBzMcYLR6c6FkzeoMHibedYDkHvLKnX2ArNie5z')
    expect(JUPITER_PLATFORM_FEE_BPS).toBe(50)
  })
})

describe('buildJupiterSwapTx', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.mocked(assertSafeSolanaSwapTransactionBase64).mockReset().mockResolvedValue(undefined)
    deriveJupiterFeeAccountMock.mockReset().mockResolvedValue(fakeFeeAccountInfo)
    prependJupiterFeeAtaMock.mockReset().mockResolvedValue('PREPENDED_UNSIGNED_TX==')
    fetchSpy = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString()
      const body = url.includes('/quote') ? fakeQuote : fakeSwap
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('builds an unsigned swap tx for SOL → USDC and surfaces route + amounts', async () => {
    const res = await buildJupiterSwapTx({
      userPublicKey: USER,
      // no fromContractAddress => native SOL
      toContractAddress: USDC_MINT,
      amountBaseUnits: 100_000_000n,
    })

    expect(res.swapTransaction).toBe('PREPENDED_UNSIGNED_TX==')
    expect(res.outAmount).toBe('14230000')
    expect(res.minOutAmount).toBe('14087700')
    expect(res.priceImpactPct).toBe('0.0011')
    expect(res.routeLabels).toEqual(['Whirlpool'])
    expect(res.inputMint).toBe(SOL_NATIVE_MINT)
    expect(res.outputMint).toBe(USDC_MINT)
  })

  it('includes platformFeeBps + feeAccount and prepends the fee ATA for the default affiliate path', async () => {
    const res = await buildJupiterSwapTx({
      userPublicKey: USER,
      toContractAddress: USDC_MINT,
      amountBaseUnits: 100_000_000n,
    })

    expect(res.affiliateFeeApplied).toBe(true)

    const quoteUrl = fetchSpy.mock.calls.find(([u]) => String(u).includes('/quote'))?.[0]
    expect(String(quoteUrl)).toContain(`platformFeeBps=${JUPITER_PLATFORM_FEE_BPS}`)

    const swapCall = fetchSpy.mock.calls.find(([u]) => String(u).includes('/swap/v1/swap'))
    const swapBody = JSON.parse((swapCall?.[1] as RequestInit).body as string)
    expect(swapBody.feeAccount).toBe(FAKE_ATA)
    expect(prependJupiterFeeAtaMock).toHaveBeenCalledWith({
      txData: fakeSwap.swapTransaction,
      feeAccount: FAKE_ATA,
      mintPubkey: fakeFeeAccountInfo.mintPubkey,
      ownerPubkey: fakeFeeAccountInfo.ownerPubkey,
      tokenProgramId: fakeFeeAccountInfo.tokenProgramId,
      userWallet: expect.any(PublicKey),
    })
    // unsigned-only contract: never wraps anything resembling a signed tx
    expect(swapBody).not.toHaveProperty('signature')
  })

  it('does not prepend the derived fee ATA when the quote floors the platform fee to zero', async () => {
    fetchSpy = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString()
      const body = url.includes('/quote')
        ? {
            ...fakeQuote,
            platformFee: { amount: '0', feeBps: JUPITER_PLATFORM_FEE_BPS },
          }
        : fakeSwap
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchSpy)

    const res = await buildJupiterSwapTx({
      userPublicKey: USER,
      toContractAddress: USDC_MINT,
      amountBaseUnits: 100_000_000n,
    })

    expect(res.affiliateFeeApplied).toBe(false)
    expect(res.swapTransaction).toBe(fakeSwap.swapTransaction)
    expect(prependJupiterFeeAtaMock).not.toHaveBeenCalled()

    const swapCall = fetchSpy.mock.calls.find(([u]) => String(u).includes('/swap/v1/swap'))
    const swapBody = JSON.parse((swapCall?.[1] as RequestInit).body as string)
    expect(swapBody).not.toHaveProperty('feeAccount')
    expect(swapBody.quoteResponse).not.toHaveProperty('platformFee')
    expect(assertSafeSolanaSwapTransactionBase64).toHaveBeenCalledWith(fakeSwap.swapTransaction, expect.any(PublicKey))
  })

  it('defaults the native mint when no contract addresses are provided', async () => {
    await buildJupiterSwapTx({
      userPublicKey: USER,
      toContractAddress: USDC_MINT,
      amountBaseUnits: 1n,
    })
    const quoteUrl = String(fetchSpy.mock.calls.find(([u]) => String(u).includes('/quote'))?.[0])
    expect(quoteUrl).toContain(`inputMint=${SOL_NATIVE_MINT}`)
  })

  it('rejects a non-positive amount', async () => {
    await expect(
      buildJupiterSwapTx({
        userPublicKey: USER,
        toContractAddress: USDC_MINT,
        amountBaseUnits: 0n,
      })
    ).rejects.toThrow(/greater than zero/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rejects identical input/output mints', async () => {
    await expect(buildJupiterSwapTx({ userPublicKey: USER, amountBaseUnits: 1n })).rejects.toThrow(/must differ/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('throws a descriptive error on a non-ok Jupiter response', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Could not find any route' }), {
        status: 400,
      })
    )
    await expect(
      buildJupiterSwapTx({
        userPublicKey: USER,
        toContractAddress: USDC_MINT,
        amountBaseUnits: 1n,
      })
    ).rejects.toThrow(/Jupiter API error \(400\): Could not find any route/)
  })

  it('propagates a JSON error body on a non-ok /swap response (build-time route failure)', async () => {
    fetchSpy.mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/quote')) {
        return new Response(JSON.stringify(fakeQuote), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      // /swap returns non-ok -> fetchJupiter must surface it as an API error, not a missing-tx error
      return new Response(JSON.stringify({ error: 'Slippage tolerance exceeded' }), { status: 422 })
    })
    await expect(
      buildJupiterSwapTx({
        userPublicKey: USER,
        toContractAddress: USDC_MINT,
        amountBaseUnits: 1n,
      })
    ).rejects.toThrow(/Jupiter API error \(422\): Slippage tolerance exceeded/)
  })

  it('errors on a 200 /swap response carrying an embedded error and never returns a partial tx', async () => {
    fetchSpy.mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/quote')) {
        return new Response(JSON.stringify(fakeQuote), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      // 200 OK but body carries an error AND no swapTransaction -> must throw, not silently succeed
      return new Response(JSON.stringify({ error: 'No route found at build time' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    await expect(
      buildJupiterSwapTx({
        userPublicKey: USER,
        toContractAddress: USDC_MINT,
        amountBaseUnits: 1n,
      })
    ).rejects.toThrow(/Jupiter swap error: No route found at build time/)
  })

  it('refuses to build when the quoted price impact exceeds the 10% ceiling (50% sandwich-bait quote)', async () => {
    fetchSpy.mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString()
      // Jupiter's priceImpactPct is a FRACTION: "0.5" == 50% impact.
      const body = url.includes('/quote') ? { ...fakeQuote, priceImpactPct: '0.5' } : fakeSwap
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    await expect(
      buildJupiterSwapTx({
        userPublicKey: USER,
        toContractAddress: USDC_MINT,
        amountBaseUnits: 100_000_000n,
      })
    ).rejects.toThrow(PriceImpactTooHighError)

    // Refused before the /swap build call was ever made.
    expect(fetchSpy.mock.calls.some(([u]) => String(u).includes('/swap/v1/swap'))).toBe(false)
  })

  it('builds normally at a price impact just under the 10% ceiling', async () => {
    fetchSpy.mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString()
      const body = url.includes('/quote') ? { ...fakeQuote, priceImpactPct: '0.0999' } : fakeSwap
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const res = await buildJupiterSwapTx({
      userPublicKey: USER,
      toContractAddress: USDC_MINT,
      amountBaseUnits: 100_000_000n,
    })
    expect(res.swapTransaction).toBe('PREPENDED_UNSIGNED_TX==')
  })

  it('builds at exactly 10% price impact (ceiling itself passes, only strictly-above rejects)', async () => {
    fetchSpy.mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString()
      const body = url.includes('/quote') ? { ...fakeQuote, priceImpactPct: '0.10' } : fakeSwap
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const res = await buildJupiterSwapTx({
      userPublicKey: USER,
      toContractAddress: USDC_MINT,
      amountBaseUnits: 100_000_000n,
    })
    expect(res.swapTransaction).toBe('PREPENDED_UNSIGNED_TX==')
  })

  it('refuses to build just above the 10% price impact ceiling', async () => {
    fetchSpy.mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString()
      const body = url.includes('/quote') ? { ...fakeQuote, priceImpactPct: '0.1001' } : fakeSwap
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    await expect(
      buildJupiterSwapTx({
        userPublicKey: USER,
        toContractAddress: USDC_MINT,
        amountBaseUnits: 100_000_000n,
      })
    ).rejects.toThrow(PriceImpactTooHighError)
  })

  it('validates the returned transaction against the instruction allow-list (SOL-01)', async () => {
    const res = await buildJupiterSwapTx({
      userPublicKey: USER,
      toContractAddress: USDC_MINT,
      amountBaseUnits: 100_000_000n,
    })

    expect(assertSafeSolanaSwapTransactionBase64).toHaveBeenCalledWith('PREPENDED_UNSIGNED_TX==', expect.any(PublicKey))
    expect(res.swapTransaction).toBe('PREPENDED_UNSIGNED_TX==')
  })

  it('propagates a refusal from the instruction allow-list guard instead of returning a signable tx', async () => {
    vi.mocked(assertSafeSolanaSwapTransactionBase64).mockRejectedValueOnce(
      new Error('SOL_SWAP_UNEXPECTED_PROGRAM: instruction 2 targets unrecognized program Evi1...; refusing to sign')
    )

    await expect(
      buildJupiterSwapTx({
        userPublicKey: USER,
        toContractAddress: USDC_MINT,
        amountBaseUnits: 100_000_000n,
      })
    ).rejects.toThrow(/SOL_SWAP_UNEXPECTED_PROGRAM/)
  })

  it('strips trailing slashes from a custom apiBaseUrl (no double-slash path)', async () => {
    await buildJupiterSwapTx({
      userPublicKey: USER,
      toContractAddress: USDC_MINT,
      amountBaseUnits: 1n,
      apiBaseUrl: 'https://proxy.example.com/jup///',
    })
    const quoteUrl = String(fetchSpy.mock.calls.find(([u]) => String(u).includes('/quote'))?.[0])
    expect(quoteUrl.startsWith('https://proxy.example.com/jup/swap/v1/quote?')).toBe(true)
    expect(quoteUrl).not.toContain('jup//swap')
  })
})

// Affiliate override invariant: when a resolver returns an ATA string directly,
// BOTH platformFeeBps (on /quote) AND feeAccount (on /swap) MUST be sent
// together. Omitting one without the other is the fund-unsafe failure mode.
// The default resolver returns full fee-account metadata and is covered above.
describe('buildJupiterSwapTx — affiliate ON (injected treasury ATA)', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.mocked(assertSafeSolanaSwapTransactionBase64).mockReset().mockResolvedValue(undefined)
    deriveJupiterFeeAccountMock.mockReset().mockResolvedValue(fakeFeeAccountInfo)
    prependJupiterFeeAtaMock.mockReset().mockResolvedValue('PREPENDED_UNSIGNED_TX==')
    fetchSpy = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString()
      const body = url.includes('/quote') ? fakeQuote : fakeSwap
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('sends BOTH platformFeeBps AND feeAccount together when an ATA resolves', async () => {
    const res = await buildJupiterSwapTx({
      userPublicKey: USER,
      toContractAddress: USDC_MINT,
      amountBaseUnits: 100_000_000n,
      resolveFeeAccount: () => FAKE_ATA,
    })

    expect(res.affiliateFeeApplied).toBe(true)

    const quoteUrl = String(fetchSpy.mock.calls.find(([u]) => String(u).includes('/quote'))?.[0])
    expect(quoteUrl).toContain(`platformFeeBps=${JUPITER_PLATFORM_FEE_BPS}`)

    const swapCall = fetchSpy.mock.calls.find(([u]) => String(u).includes('/swap/v1/swap'))
    const swapBody = JSON.parse((swapCall?.[1] as RequestInit).body as string)
    expect(swapBody.feeAccount).toBe(FAKE_ATA)
    expect(prependJupiterFeeAtaMock).not.toHaveBeenCalled()
  })

  it('keeps the affiliate fee OFF when the quote floors platformFee.amount to zero', async () => {
    fetchSpy = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString()
      const body = url.includes('/quote')
        ? {
            ...fakeQuote,
            platformFee: { amount: '0', feeBps: JUPITER_PLATFORM_FEE_BPS },
          }
        : fakeSwap
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchSpy)

    const res = await buildJupiterSwapTx({
      userPublicKey: USER,
      toContractAddress: USDC_MINT,
      amountBaseUnits: 100_000_000n,
      resolveFeeAccount: () => FAKE_ATA,
    })

    expect(res.affiliateFeeApplied).toBe(false)

    const quoteUrl = String(fetchSpy.mock.calls.find(([u]) => String(u).includes('/quote'))?.[0])
    expect(quoteUrl).toContain(`platformFeeBps=${JUPITER_PLATFORM_FEE_BPS}`)

    const swapCall = fetchSpy.mock.calls.find(([u]) => String(u).includes('/swap/v1/swap'))
    const swapBody = JSON.parse((swapCall?.[1] as RequestInit).body as string)
    expect(swapBody).not.toHaveProperty('feeAccount')
    expect(swapBody.quoteResponse).not.toHaveProperty('platformFee')
  })

  it('keeps the affiliate fee OFF (both fields omitted) when the resolver returns null', async () => {
    const res = await buildJupiterSwapTx({
      userPublicKey: USER,
      toContractAddress: USDC_MINT,
      amountBaseUnits: 100_000_000n,
      resolveFeeAccount: () => null,
    })

    expect(res.affiliateFeeApplied).toBe(false)

    const quoteUrl = String(fetchSpy.mock.calls.find(([u]) => String(u).includes('/quote'))?.[0])
    expect(quoteUrl).not.toContain('platformFeeBps')

    const swapCall = fetchSpy.mock.calls.find(([u]) => String(u).includes('/swap/v1/swap'))
    const swapBody = JSON.parse((swapCall?.[1] as RequestInit).body as string)
    expect(swapBody).not.toHaveProperty('feeAccount')
  })

  it('keeps the swap available without an affiliate fee when fee-account resolution fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const res = await buildJupiterSwapTx({
      userPublicKey: USER,
      toContractAddress: USDC_MINT,
      amountBaseUnits: 100_000_000n,
      resolveFeeAccount: () => Promise.reject(new Error('Solana RPC unavailable')),
    })

    expect(res.affiliateFeeApplied).toBe(false)
    expect(res.swapTransaction).toBe(fakeSwap.swapTransaction)
    expect(prependJupiterFeeAtaMock).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(
      'Failed to resolve Jupiter affiliate fee account; continuing without an affiliate fee:',
      'Solana RPC unavailable'
    )

    const quoteUrl = String(fetchSpy.mock.calls.find(([u]) => String(u).includes('/quote'))?.[0])
    expect(quoteUrl).not.toContain('platformFeeBps')

    const swapCall = fetchSpy.mock.calls.find(([u]) => String(u).includes('/swap/v1/swap'))
    const swapBody = JSON.parse((swapCall?.[1] as RequestInit).body as string)
    expect(swapBody).not.toHaveProperty('feeAccount')
  })

  // --- sdk#1738: bounded 429 retry against the shared api.vultisig.com/jup proxy ---
  //
  // These use fake timers: the retry sleeps 300ms then 600ms, and a real-timer version
  // would add ~0.9s of wall clock per exhaustion test for no extra coverage.

  it('retries a 429 and succeeds on the retry (sdk#1738)', async () => {
    let quoteCalls = 0
    fetchSpy = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/quote')) {
        quoteCalls++
        if (quoteCalls === 1) {
          return new Response(JSON.stringify({ error: 'rate limit' }), {
            status: 429,
            headers: { 'Content-Type': 'application/json' },
          })
        }
      }
      const body = url.includes('/quote') ? fakeQuote : fakeSwap
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchSpy)
    vi.useFakeTimers()
    try {
      const promise = buildJupiterSwapTx({
        userPublicKey: USER,
        toContractAddress: USDC_MINT,
        amountBaseUnits: 100_000_000n,
      })
      await vi.runAllTimersAsync()
      const res = await promise
      // The transient 429 is absorbed: the caller sees a normal successful quote.
      expect(res.outAmount).toBe('14230000')
      expect(quoteCalls).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('gives up after the retry budget and surfaces the 429 (sdk#1738)', async () => {
    let quoteCalls = 0
    fetchSpy = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/quote')) {
        quoteCalls++
        return new Response(JSON.stringify({ error: 'rate limit' }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify(fakeSwap), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchSpy)
    vi.useFakeTimers()
    try {
      const promise = buildJupiterSwapTx({
        userPublicKey: USER,
        toContractAddress: USDC_MINT,
        amountBaseUnits: 100_000_000n,
      }).catch((e: unknown) => e as Error)
      await vi.runAllTimersAsync()
      const err = await promise
      expect(String(err)).toMatch(/429/)
      // Bounded, not infinite: 1 initial attempt + JUPITER_MAX_RETRIES.
      expect(quoteCalls).toBe(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('spaces the retries on a 300ms linear backoff (sdk#1738)', async () => {
    // Pins the SCHEDULE, not just the final count: a regression to 0ms backoff (or to
    // exponential) would still end at 3 calls and slip past the exhaustion test above.
    let quoteCalls = 0
    fetchSpy = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/quote')) {
        quoteCalls++
        return new Response(JSON.stringify({ error: 'rate limit' }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify(fakeSwap), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchSpy)
    vi.useFakeTimers()
    try {
      const settled = buildJupiterSwapTx({
        userPublicKey: USER,
        toContractAddress: USDC_MINT,
        amountBaseUnits: 100_000_000n,
      }).catch((e: unknown) => e as Error)

      // Let the initial attempt run, then walk each backoff boundary.
      await vi.advanceTimersByTimeAsync(0)
      expect(quoteCalls).toBe(1)

      await vi.advanceTimersByTimeAsync(299)
      expect(quoteCalls).toBe(1) // first retry has not fired yet

      await vi.advanceTimersByTimeAsync(1)
      expect(quoteCalls).toBe(2) // fires at t=300 (300 * attempt 1)

      await vi.advanceTimersByTimeAsync(599)
      expect(quoteCalls).toBe(2) // second retry waits 600ms, not another 300ms

      await vi.advanceTimersByTimeAsync(1)
      expect(quoteCalls).toBe(3) // fires at t=900 cumulative (300 * attempt 2)

      await vi.runAllTimersAsync()
      expect(String(await settled)).toMatch(/429/)
      expect(quoteCalls).toBe(3) // and stops there
    } finally {
      vi.useRealTimers()
    }
  })

  it('does NOT retry a non-429 error status (sdk#1738)', async () => {
    let quoteCalls = 0
    fetchSpy = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/quote')) {
        quoteCalls++
        return new Response(JSON.stringify({ error: 'no route found' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify(fakeSwap), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchSpy)

    await expect(
      buildJupiterSwapTx({ userPublicKey: USER, toContractAddress: USDC_MINT, amountBaseUnits: 100_000_000n })
    ).rejects.toThrow(/400/)
    // A 4xx will not heal by re-asking — retrying it only multiplies latency.
    expect(quoteCalls).toBe(1)
  })
})
