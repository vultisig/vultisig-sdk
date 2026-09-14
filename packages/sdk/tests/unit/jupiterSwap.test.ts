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
})

describe('buildJupiterSwapTx — bounded rate-limit retries', () => {
  const params = { userPublicKey: USER, toContractAddress: USDC_MINT, amountBaseUnits: 100_000_000n }
  let fetchSpy: ReturnType<typeof vi.fn>
  let counts: { quote: number; swap: number }

  const respond = (quoteFailures: number, swapFailures: number, status = 429, body = '{"error":"Rate limited"}') => {
    fetchSpy.mockImplementation(async (input: string) => {
      const endpoint = input.includes('/quote?') ? 'quote' : 'swap'
      counts[endpoint]++
      const failures = endpoint === 'quote' ? quoteFailures : swapFailures
      return counts[endpoint] <= failures
        ? new Response(body, { status, statusText: 'Too Many Requests' })
        : new Response(JSON.stringify(endpoint === 'quote' ? fakeQuote : fakeSwap))
    })
  }

  beforeEach(() => {
    vi.useFakeTimers()
    counts = { quote: 0, swap: 0 }
    fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    deriveJupiterFeeAccountMock.mockReset().mockResolvedValue(fakeFeeAccountInfo)
    prependJupiterFeeAtaMock.mockReset().mockResolvedValue('PREPENDED_UNSIGNED_TX==')
    vi.mocked(assertSafeSolanaSwapTransactionBase64).mockReset().mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it.each([
    ['quote', 1],
    ['quote', 2],
    ['swap', 1],
    ['swap', 2],
  ] as const)('recovers %s after %i rate limits at the exact retry boundaries', async (endpoint, failures) => {
    respond(endpoint === 'quote' ? failures : 0, endpoint === 'swap' ? failures : 0)
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout')
    const result = buildJupiterSwapTx(params)
    await vi.advanceTimersByTimeAsync(0)
    expect(counts[endpoint]).toBe(1)
    await vi.advanceTimersByTimeAsync(299)
    expect(counts[endpoint]).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(counts[endpoint]).toBe(2)
    if (failures === 2) {
      await vi.advanceTimersByTimeAsync(599)
      expect(counts[endpoint]).toBe(2)
      await vi.advanceTimersByTimeAsync(1)
      expect(counts[endpoint]).toBe(3)
    }
    await expect(result).resolves.toMatchObject({ affiliateFeeApplied: true, outAmount: fakeQuote.outAmount })
    expect(counts).toEqual({
      quote: endpoint === 'quote' ? failures + 1 : 1,
      swap: endpoint === 'swap' ? failures + 1 : 1,
    })
    const calls = fetchSpy.mock.calls.filter(([url]) => String(url).includes(`/swap/v1/${endpoint}`))
    const requests = calls.map(([url, init]) => ({ url, ...init, signal: undefined }))
    expect(requests.every(request => JSON.stringify(request) === JSON.stringify(requests[0]))).toBe(true)
    expect(new Set(calls.map(([, init]) => init.signal)).size).toBe(failures + 1)
    expect(timeoutSpy).toHaveBeenCalledTimes(failures + 2)
    expect(timeoutSpy.mock.calls.every(([timeout]) => timeout === 15_000)).toBe(true)
    const swapInit = fetchSpy.mock.calls.find(([url]) => String(url).includes('/swap/v1/swap'))![1]
    expect(swapInit).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'application/json' } })
    expect(JSON.parse(swapInit.body)).toMatchObject({ feeAccount: FAKE_ATA, quoteResponse: fakeQuote })
    expect(prependJupiterFeeAtaMock).toHaveBeenCalledTimes(1)
    expect(assertSafeSolanaSwapTransactionBase64).toHaveBeenCalledWith('PREPENDED_UNSIGNED_TX==', expect.any(PublicKey))
  })

  it('keeps independent budgets when both operations are rate-limited', async () => {
    respond(2, 2)
    const result = buildJupiterSwapTx(params)
    await vi.advanceTimersByTimeAsync(1800)
    await expect(result).resolves.toMatchObject({ outAmount: fakeQuote.outAmount })
    expect(counts).toEqual({ quote: 3, swap: 3 })
  })

  it.each(['quote', 'swap'] as const)('surfaces the final %s error after exactly three attempts', async endpoint => {
    respond(endpoint === 'quote' ? 3 : 0, endpoint === 'swap' ? 3 : 0)
    const rejection = expect(buildJupiterSwapTx(params)).rejects.toThrow('Jupiter API error (429): Rate limited')
    await vi.advanceTimersByTimeAsync(900)
    await rejection
    await vi.advanceTimersByTimeAsync(10_000)
    expect(counts).toEqual({ quote: endpoint === 'quote' ? 3 : 1, swap: endpoint === 'swap' ? 3 : 0 })
    expect(assertSafeSolanaSwapTransactionBase64).not.toHaveBeenCalled()
  })

  it('retries non-JSON 429s and preserves the final status-text error', async () => {
    respond(3, 0, 429, 'rate limited')
    const rejection = expect(buildJupiterSwapTx(params)).rejects.toThrow('Jupiter API error (429): Too Many Requests')
    await vi.advanceTimersByTimeAsync(900)
    await rejection
    expect(counts).toEqual({ quote: 3, swap: 0 })
  })

  it('adds no delay to healthy requests', async () => {
    respond(0, 0)
    await expect(buildJupiterSwapTx(params)).resolves.toMatchObject({ outAmount: fakeQuote.outAmount })
    expect(counts).toEqual({ quote: 1, swap: 1 })
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([400, 422, 500, 503])('does not retry HTTP %i on either endpoint', async status => {
    for (const endpoint of ['quote', 'swap']) {
      counts = { quote: 0, swap: 0 }
      respond(endpoint === 'quote' ? 3 : 0, endpoint === 'swap' ? 3 : 0, status)
      await expect(buildJupiterSwapTx(params)).rejects.toThrow(`Jupiter API error (${status})`)
      expect(counts).toEqual({ quote: 1, swap: endpoint === 'swap' ? 1 : 0 })
      expect(vi.getTimerCount()).toBe(0)
    }
  })

  it.each([new TypeError('fetch failed'), new DOMException('timed out', 'TimeoutError')])(
    'does not retry rejected fetches: %s',
    async error => {
      for (const endpoint of ['quote', 'swap']) {
        fetchSpy.mockReset()
        if (endpoint === 'swap') fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(fakeQuote)))
        fetchSpy.mockRejectedValueOnce(error)
        await expect(buildJupiterSwapTx(params)).rejects.toBe(error)
        expect(fetchSpy).toHaveBeenCalledTimes(endpoint === 'swap' ? 2 : 1)
        expect(vi.getTimerCount()).toBe(0)
      }
    }
  )

  it.each([new TypeError('body download failed'), new DOMException('body timed out', 'TimeoutError')])(
    'does not retry response-body failures: %s',
    async error => {
      for (const endpoint of ['quote', 'swap']) {
        fetchSpy.mockReset()
        if (endpoint === 'swap') fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(fakeQuote)))
        const response = new Response(new ReadableStream({ start: controller => controller.error(error) }), {
          status: 429,
        })
        fetchSpy.mockResolvedValueOnce(response)
        await expect(buildJupiterSwapTx(params)).rejects.toBe(error)
        expect(fetchSpy).toHaveBeenCalledTimes(endpoint === 'swap' ? 2 : 1)
        expect(vi.getTimerCount()).toBe(0)
      }
    }
  )

  it('still rejects excessive price impact after a recovered quote', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 429 }))
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ ...fakeQuote, priceImpactPct: '0.5' })))
    const rejection = expect(buildJupiterSwapTx(params)).rejects.toBeInstanceOf(PriceImpactTooHighError)
    await vi.advanceTimersByTimeAsync(300)
    await rejection
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(prependJupiterFeeAtaMock).not.toHaveBeenCalled()
  })

  it('still rejects unsafe instructions after a recovered swap build', async () => {
    respond(0, 1)
    vi.mocked(assertSafeSolanaSwapTransactionBase64).mockRejectedValueOnce(new Error('unsafe instruction'))
    const rejection = expect(buildJupiterSwapTx(params)).rejects.toThrow('unsafe instruction')
    await vi.advanceTimersByTimeAsync(300)
    await rejection
    expect(counts).toEqual({ quote: 1, swap: 2 })
  })
})
