import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildJupiterSwapTx,
  JUPITER_AFFILIATE_FEE_OWNER,
  JUPITER_PLATFORM_FEE_BPS,
  resolveJupiterFeeAccount,
  SOL_NATIVE_MINT,
} from '../../src/tools/swap/jupiter'

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const USER = '5QXePTiaWgmqSCHh9YDWAiVvEeKWaM5cUN62K4SXwUSB'

const fakeQuote = {
  inputMint: SOL_NATIVE_MINT,
  inAmount: '100000000',
  outputMint: USDC_MINT,
  outAmount: '14230000',
  otherAmountThreshold: '14087700',
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
  it('returns null when no treasury ATA is configured for the output mint (default OFF)', () => {
    expect(resolveJupiterFeeAccount(USDC_MINT)).toBeNull()
  })

  it('exposes the treasury owner and bps as source-of-truth constants', () => {
    expect(JUPITER_AFFILIATE_FEE_OWNER).toBe('5QXePTiaWgmqSCHh9YDWAiVvEeKWaM5cUN62K4SXwUSB')
    expect(JUPITER_PLATFORM_FEE_BPS).toBe(50)
  })
})

describe('buildJupiterSwapTx', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchSpy = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString()
      const body = url.includes('/quote') ? fakeQuote : fakeSwap
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
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

    expect(res.swapTransaction).toBe('BASE64_UNSIGNED_TX==')
    expect(res.outAmount).toBe('14230000')
    expect(res.minOutAmount).toBe('14087700')
    expect(res.priceImpactPct).toBe('0.0011')
    expect(res.routeLabels).toEqual(['Whirlpool'])
    expect(res.inputMint).toBe(SOL_NATIVE_MINT)
    expect(res.outputMint).toBe(USDC_MINT)
  })

  it('omits platformFeeBps + feeAccount when no treasury ATA exists (affiliate OFF, safe default)', async () => {
    const res = await buildJupiterSwapTx({
      userPublicKey: USER,
      toContractAddress: USDC_MINT,
      amountBaseUnits: 100_000_000n,
    })

    expect(res.affiliateFeeApplied).toBe(false)

    const quoteUrl = fetchSpy.mock.calls.find(([u]) => String(u).includes('/quote'))?.[0]
    expect(String(quoteUrl)).not.toContain('platformFeeBps')

    const swapCall = fetchSpy.mock.calls.find(([u]) => String(u).includes('/swap/v1/swap'))
    const swapBody = JSON.parse((swapCall?.[1] as RequestInit).body as string)
    expect(swapBody).not.toHaveProperty('feeAccount')
    // unsigned-only contract: never wraps anything resembling a signed tx
    expect(swapBody).not.toHaveProperty('signature')
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
      buildJupiterSwapTx({ userPublicKey: USER, toContractAddress: USDC_MINT, amountBaseUnits: 0n })
    ).rejects.toThrow(/greater than zero/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rejects identical input/output mints', async () => {
    await expect(buildJupiterSwapTx({ userPublicKey: USER, amountBaseUnits: 1n })).rejects.toThrow(/must differ/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('throws a descriptive error on a non-ok Jupiter response', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Could not find any route' }), { status: 400 }))
    await expect(
      buildJupiterSwapTx({ userPublicKey: USER, toContractAddress: USDC_MINT, amountBaseUnits: 1n })
    ).rejects.toThrow(/Jupiter API error \(400\): Could not find any route/)
  })

  it('propagates a JSON error body on a non-ok /swap response (build-time route failure)', async () => {
    fetchSpy.mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/quote')) {
        return new Response(JSON.stringify(fakeQuote), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      // /swap returns non-ok -> fetchJupiter must surface it as an API error, not a missing-tx error
      return new Response(JSON.stringify({ error: 'Slippage tolerance exceeded' }), { status: 422 })
    })
    await expect(
      buildJupiterSwapTx({ userPublicKey: USER, toContractAddress: USDC_MINT, amountBaseUnits: 1n })
    ).rejects.toThrow(/Jupiter API error \(422\): Slippage tolerance exceeded/)
  })

  it('errors on a 200 /swap response carrying an embedded error and never returns a partial tx', async () => {
    fetchSpy.mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/quote')) {
        return new Response(JSON.stringify(fakeQuote), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      // 200 OK but body carries an error AND no swapTransaction -> must throw, not silently succeed
      return new Response(JSON.stringify({ error: 'No route found at build time' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    await expect(
      buildJupiterSwapTx({ userPublicKey: USER, toContractAddress: USDC_MINT, amountBaseUnits: 1n })
    ).rejects.toThrow(/Jupiter swap error: No route found at build time/)
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

// Affiliate-ON invariant: when a treasury ATA DOES resolve for the output mint,
// BOTH platformFeeBps (on /quote) AND feeAccount (on /swap) MUST be sent
// together. Omitting one without the other is the fund-unsafe failure mode
// (Jupiter quotes a route whose fee transfer has nowhere to land -> the user's
// broadcast reverts with SPL Token 0x17 InvalidAccountData). The empty ATA map
// means the production OFF path is the only one exercised above; these cases
// drive the resolver test-seam to lock the symmetric ON path so a future
// regression that moves one `if (feeAccount)` guard but not the other is caught.
describe('buildJupiterSwapTx — affiliate ON (injected treasury ATA)', () => {
  const FAKE_ATA = 'CRz7ucCE6ZFhN297AC56ihUBbdDuZNzN3D7MVw2cYPna'
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchSpy = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString()
      const body = url.includes('/quote') ? fakeQuote : fakeSwap
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
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
})
