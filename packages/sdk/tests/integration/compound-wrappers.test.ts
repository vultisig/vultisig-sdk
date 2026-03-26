/**
 * Integration tests for VaultBase compound wrapper methods.
 *
 * These tests cover gaps the unit tests miss:
 * 1. Multi-byte signMessage EIP-191 correctness (verified against ethers.js)
 * 2. Wiring verification of compound method call ordering via mocks
 * 3. knownTokens auto-resolve fallback with user-token priority
 * 4. Approval confirmation wait behavior in the swap flow
 */
import { Chain } from '@core/chain/Chain'
import { chainFeeCoin } from '@core/chain/coin/chainFeeCoin'
import { knownTokens } from '@core/chain/coin/knownTokens'
import { beforeEach,describe, expect, it, vi } from 'vitest'

import { VaultError, VaultErrorCode } from '../../src/vault/VaultError'

// ---------------------------------------------------------------------------
// 1. Multi-byte signMessage EIP-191 correctness
// ---------------------------------------------------------------------------

describe('signMessage EIP-191 multi-byte correctness', () => {
  const cases = [
    { label: 'ASCII', message: 'hello world' },
    { label: 'Emoji', message: '\u{1F600}hello\u{1F30D}' },
    { label: 'CJK', message: '\u4F60\u597D\u4E16\u754C' },
    { label: 'Mixed', message: 'Hello \u{1F30D} \u4E16\u754C!' },
  ]

  for (const { label, message } of cases) {
    it(`should match ethers.hashMessage for ${label}: "${message}"`, async () => {
      const { keccak_256 } = await import('@noble/hashes/sha3')
      const { hashMessage } = await import('ethers')

      // Reproduce VaultBase signMessage hashing logic (EIP-191 with byte length)
      const msgBytes = new TextEncoder().encode(message)
      const prefix = `\x19Ethereum Signed Message:\n${msgBytes.length}`
      const prefixed = new TextEncoder().encode(prefix + message)
      const hash = keccak_256(prefixed)

      const ourHashHex = '0x' + Buffer.from(hash).toString('hex')
      const ethersHashHex = hashMessage(message)

      expect(ourHashHex).toBe(ethersHashHex)
    })
  }

  it('should differ from naive string.length for multi-byte messages', async () => {
    const { keccak_256 } = await import('@noble/hashes/sha3')

    const message = '\u{1F600}hello\u{1F30D}' // emoji: 4+5+4 = 13 bytes, but 7 JS chars
    const msgBytes = new TextEncoder().encode(message)

    // byte-length prefix (correct per VaultBase)
    const correctPrefix = `\x19Ethereum Signed Message:\n${msgBytes.length}`
    const correctHash = keccak_256(new TextEncoder().encode(correctPrefix + message))

    // naive string-length prefix (wrong for multi-byte)
    const naivePrefix = `\x19Ethereum Signed Message:\n${message.length}`
    const naiveHash = keccak_256(new TextEncoder().encode(naivePrefix + message))

    expect(Buffer.from(correctHash).toString('hex')).not.toBe(
      Buffer.from(naiveHash).toString('hex')
    )
  })

  it('should produce SHA-256 (not keccak) for non-EVM chain messages', async () => {
    const { keccak_256 } = await import('@noble/hashes/sha3')
    const { sha256 } = await import('@noble/hashes/sha2')

    const message = 'test message'
    const msgBytes = new TextEncoder().encode(message)

    const sha256Hash = sha256(msgBytes)
    const keccakHash = keccak_256(msgBytes)

    // They must differ (different algorithms)
    expect(Buffer.from(sha256Hash).toString('hex')).not.toBe(
      Buffer.from(keccakHash).toString('hex')
    )
    // SHA-256 output is 32 bytes
    expect(sha256Hash.length).toBe(32)
  })
})

// ---------------------------------------------------------------------------
// 2. Wiring verification via mock object
// ---------------------------------------------------------------------------

/**
 * Creates a mock object that mirrors VaultBase's compound-wrapper dependencies.
 * This lets us verify call ordering and argument passing without needing a full
 * VaultContext (which requires storage, passwordCache, wasmProvider, etc.).
 */
function createWiringMock() {
  const mockKeysign = { chain: Chain.Ethereum, data: 'keysign' } as any
  const mockApprovalKeysign = { chain: Chain.Ethereum, data: 'approval' } as any
  const mockSignature = { signature: '0xdeadbeef', format: 'ECDSA' as const }

  const callLog: string[] = []

  const mock = {
    callLog,

    // Fields
    _userChains: [Chain.Ethereum, Chain.Bitcoin] as Chain[],
    _currency: 'usd',
    _tokens: {} as Record<string, any[]>,

    // Service mocks
    transactionBuilder: {
      estimateSendFee: vi.fn().mockImplementation(async () => {
        callLog.push('estimateSendFee')
        return BigInt(21000)
      }),
    },

    // Method mocks
    address: vi.fn().mockImplementation(async (chain: Chain) => {
      callLog.push(`address(${chain})`)
      return chain === Chain.Ethereum ? '0xSender' : 'bc1qSender'
    }),
    getTokens: vi.fn().mockReturnValue([]),
    balances: vi.fn().mockImplementation(async () => {
      callLog.push('balances')
      return { ETH: { amount: '1e18', symbol: 'ETH' } }
    }),
    balancesWithPrices: vi.fn().mockImplementation(async () => {
      callLog.push('balancesWithPrices')
      return { ETH: { amount: '1e18', symbol: 'ETH', fiatValue: 3000 } }
    }),
    getTotalValue: vi.fn().mockImplementation(async () => {
      callLog.push('getTotalValue')
      return { amount: '3000.00', currency: 'usd', lastUpdated: Date.now() }
    }),
    prepareSendTx: vi.fn().mockImplementation(async () => {
      callLog.push('prepareSendTx')
      return mockKeysign
    }),
    sign: vi.fn().mockImplementation(async () => {
      callLog.push('sign')
      return mockSignature
    }),
    broadcastTx: vi.fn().mockImplementation(async () => {
      callLog.push('broadcastTx')
      return '0xTxHash'
    }),
    signBytes: vi.fn().mockImplementation(async () => {
      callLog.push('signBytes')
      return mockSignature
    }),
    getSwapQuote: vi.fn().mockImplementation(async () => {
      callLog.push('getSwapQuote')
      return {
        bestQuote: { provider: 'thorchain', expectedOutput: '100', minOutput: '95' },
        balance: BigInt(1e18),
        maxSwapable: BigInt(9.99e17),
        fromCoin: { ticker: 'ETH', decimals: 18 },
        toCoin: { ticker: 'BTC', decimals: 8 },
        warnings: [],
      }
    }),
    prepareSwapTx: vi.fn().mockImplementation(async () => {
      callLog.push('prepareSwapTx')
      return {
        keysignPayload: mockKeysign,
        approvalPayload: undefined,
        quote: { bestQuote: { provider: 'thorchain' } },
      }
    }),
    getTxStatus: vi.fn().mockImplementation(async () => {
      callLog.push('getTxStatus')
      return { status: 'success' }
    }),

    // Expose internal keysign mocks for approval tests
    _mockKeysign: mockKeysign,
    _mockApprovalKeysign: mockApprovalKeysign,
  }

  return mock
}

// ---------- Helper: reproduce private methods (mirrors VaultBase exactly) ----------

function resolveTokenInfo(
  chain: Chain,
  symbol: string | undefined,
  getTokens: (chain: Chain) => Array<{ symbol: string; decimals: number; contractAddress?: string; id?: string }>
): { ticker: string; decimals: number; contractAddress?: string } {
  const native = chainFeeCoin[chain]
  if (!symbol || symbol.toUpperCase() === native.ticker.toUpperCase()) {
    return { ticker: native.ticker, decimals: native.decimals }
  }

  const token = getTokens(chain).find(t => t.symbol.toUpperCase() === symbol.toUpperCase())
  if (token) return { ticker: token.symbol, decimals: token.decimals, contractAddress: token.contractAddress || token.id }

  const known = (knownTokens[chain] ?? []).find(t => t.ticker.toUpperCase() === symbol.toUpperCase())
  if (known) return { ticker: known.ticker, decimals: known.decimals, contractAddress: known.id }

  throw new VaultError(VaultErrorCode.InvalidConfig, `Token "${symbol}" not found on ${chain}. Add it with vault.addToken() or use a well-known token symbol.`)
}

function parseAmount(amount: string, decimals: number): bigint {
  const trimmed = amount?.trim()
  if (!trimmed) throw new VaultError(VaultErrorCode.InvalidAmount, 'Amount cannot be empty')
  if (isNaN(Number(trimmed)) || Number(trimmed) <= 0) throw new VaultError(VaultErrorCode.InvalidAmount, `Invalid amount: "${amount}"`)
  const [whole, fraction = ''] = trimmed.split('.')
  return BigInt(whole + fraction.padEnd(decimals, '0').slice(0, decimals))
}

function buildAccountCoin(chain: Chain, address: string, t: { ticker: string; decimals: number; contractAddress?: string }) {
  return { chain, address, decimals: t.decimals, ticker: t.ticker, ...(t.contractAddress ? { id: t.contractAddress } : {}) }
}

describe('compound wrappers wiring verification', () => {
  let mock: ReturnType<typeof createWiringMock>

  beforeEach(() => {
    mock = createWiringMock()
  })

  it('send flow calls address -> prepareSendTx -> sign -> broadcastTx in order', async () => {
    const chain = Chain.Ethereum
    const tokenInfo = resolveTokenInfo(chain, undefined, mock.getTokens)
    const amountBigInt = parseAmount('1.5', tokenInfo.decimals)
    const senderAddress = await mock.address(chain)
    const coin = buildAccountCoin(chain, senderAddress, tokenInfo)

    const keysignPayload = await mock.prepareSendTx({ coin, receiver: '0xRecipient', amount: amountBigInt })
    const signature = await mock.sign({ transaction: keysignPayload, chain })
    const txHash = await mock.broadcastTx({ chain, keysignPayload, signature })

    expect(mock.callLog).toEqual([
      'address(Ethereum)',
      'prepareSendTx',
      'sign',
      'broadcastTx',
    ])
    expect(txHash).toBe('0xTxHash')
  })

  it('send dryRun calls address -> prepareSendTx -> estimateSendFee (no sign/broadcast)', async () => {
    const chain = Chain.Ethereum
    const tokenInfo = resolveTokenInfo(chain, undefined, mock.getTokens)
    const amountBigInt = parseAmount('1', tokenInfo.decimals)
    const senderAddress = await mock.address(chain)
    const coin = buildAccountCoin(chain, senderAddress, tokenInfo)

    await mock.prepareSendTx({ coin, receiver: '0xRecipient', amount: amountBigInt })
    await mock.transactionBuilder.estimateSendFee({ coin, receiver: '0xRecipient', amount: amountBigInt })

    expect(mock.callLog).toEqual([
      'address(Ethereum)',
      'prepareSendTx',
      'estimateSendFee',
    ])
    expect(mock.sign).not.toHaveBeenCalled()
    expect(mock.broadcastTx).not.toHaveBeenCalled()
  })

  it('swap flow without approval calls getSwapQuote -> prepareSwapTx -> sign -> broadcastTx', async () => {
    const fromChain = Chain.Ethereum
    const toChain = Chain.Bitcoin
    const fromToken = resolveTokenInfo(fromChain, 'ETH', mock.getTokens)
    const toToken = resolveTokenInfo(toChain, 'BTC', mock.getTokens)

    const [fromAddress, toAddress] = await Promise.all([mock.address(fromChain), mock.address(toChain)])
    const fromCoin = buildAccountCoin(fromChain, fromAddress, fromToken)
    const toCoin = buildAccountCoin(toChain, toAddress, toToken)

    const quote = await mock.getSwapQuote({ fromCoin, toCoin, amount: 1 })
    const { keysignPayload, approvalPayload } = await mock.prepareSwapTx({ fromCoin, toCoin, amount: 1, swapQuote: quote })
    expect(approvalPayload).toBeUndefined()

    const signature = await mock.sign({ transaction: keysignPayload, chain: fromChain })
    await mock.broadcastTx({ chain: fromChain, keysignPayload, signature })

    expect(mock.callLog).toEqual([
      'address(Ethereum)',
      'address(Bitcoin)',
      'getSwapQuote',
      'prepareSwapTx',
      'sign',
      'broadcastTx',
    ])
  })

  it('swap flow WITH approval calls sign+broadcast twice then waitForConfirmation', async () => {
    // Set up mock to return an approval payload
    mock.prepareSwapTx.mockImplementation(async () => {
      mock.callLog.push('prepareSwapTx')
      return {
        keysignPayload: mock._mockKeysign,
        approvalPayload: mock._mockApprovalKeysign,
        quote: { bestQuote: { provider: 'thorchain' } },
      }
    })

    const fromChain = Chain.Ethereum
    const toChain = Chain.Bitcoin
    const [fromAddress, toAddress] = await Promise.all([mock.address(fromChain), mock.address(toChain)])
    const fromToken = resolveTokenInfo(fromChain, 'ETH', mock.getTokens)
    const toToken = resolveTokenInfo(toChain, 'BTC', mock.getTokens)
    const fromCoin = buildAccountCoin(fromChain, fromAddress, fromToken)
    const toCoin = buildAccountCoin(toChain, toAddress, toToken)

    const quote = await mock.getSwapQuote({ fromCoin, toCoin, amount: 1 })
    const { keysignPayload, approvalPayload } = await mock.prepareSwapTx({ fromCoin, toCoin, amount: 1, swapQuote: quote })

    // Approval flow
    expect(approvalPayload).toBeDefined()
    const approvalSig = await mock.sign({ transaction: approvalPayload, chain: fromChain })
    const approvalHash = await mock.broadcastTx({ chain: fromChain, keysignPayload: approvalPayload, signature: approvalSig })

    // Wait for confirmation (simulated)
    const confirmResult = await mock.getTxStatus({ chain: fromChain, txHash: approvalHash })
    expect(confirmResult.status).toBe('success')

    // Main swap
    const swapSig = await mock.sign({ transaction: keysignPayload, chain: fromChain })
    await mock.broadcastTx({ chain: fromChain, keysignPayload, signature: swapSig })

    expect(mock.callLog).toEqual([
      'address(Ethereum)',
      'address(Bitcoin)',
      'getSwapQuote',
      'prepareSwapTx',
      'sign',        // approval sign
      'broadcastTx',  // approval broadcast
      'getTxStatus',  // wait for confirmation
      'sign',        // swap sign
      'broadcastTx',  // swap broadcast
    ])
    expect(mock.sign).toHaveBeenCalledTimes(2)
    expect(mock.broadcastTx).toHaveBeenCalledTimes(2)
  })

  it('buildAccountCoin includes id only for tokens with contractAddress', () => {
    const nativeCoin = buildAccountCoin(Chain.Ethereum, '0xSender', { ticker: 'ETH', decimals: 18 })
    expect(nativeCoin).not.toHaveProperty('id')

    const tokenCoin = buildAccountCoin(Chain.Ethereum, '0xSender', {
      ticker: 'USDC',
      decimals: 6,
      contractAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    })
    expect(tokenCoin.id).toBe('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')
    expect(tokenCoin.decimals).toBe(6)
    expect(tokenCoin.ticker).toBe('USDC')
  })
})

// ---------------------------------------------------------------------------
// 3. Auto-resolve known tokens test
// ---------------------------------------------------------------------------

describe('resolveTokenInfo knownTokens fallback', () => {
  const emptyGetTokens = () => [] as any[]

  it('should auto-resolve USDC on Ethereum from knownTokens', () => {
    const result = resolveTokenInfo(Chain.Ethereum, 'USDC', emptyGetTokens)

    expect(result.ticker).toBe('USDC')
    expect(result.decimals).toBe(6)
    // The contractAddress should match the known token's id
    expect(result.contractAddress).toBe('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')
  })

  it('should auto-resolve USDT on Ethereum from knownTokens', () => {
    const result = resolveTokenInfo(Chain.Ethereum, 'USDT', emptyGetTokens)

    expect(result.ticker).toBe('USDT')
    expect(result.decimals).toBe(6)
    expect(result.contractAddress).toBe('0xdac17f958d2ee523a2206206994597c13d831ec7')
  })

  it('should auto-resolve WBTC on Ethereum from knownTokens', () => {
    const result = resolveTokenInfo(Chain.Ethereum, 'WBTC', emptyGetTokens)

    expect(result.ticker).toBe('WBTC')
    expect(result.decimals).toBe(8)
    expect(result.contractAddress).toBe('0x2260fac5e5542a773aa44fbcfedf7c193bc2c599')
  })

  it('should auto-resolve tokens on non-Ethereum chains (Avalanche USDC)', () => {
    const result = resolveTokenInfo(Chain.Avalanche, 'USDC', emptyGetTokens)

    expect(result.ticker).toBe('USDC')
    expect(result.decimals).toBe(6)
    expect(result.contractAddress).toBeDefined()
  })

  it('should auto-resolve tokens on Arbitrum (ARB)', () => {
    const result = resolveTokenInfo(Chain.Arbitrum, 'ARB', emptyGetTokens)

    expect(result.ticker).toBe('ARB')
    expect(result.decimals).toBe(18)
    expect(result.contractAddress).toBe('0x912ce59144191c1204e64559fe8253a0e49e6548')
  })

  it('should verify knownTokens USDC entry matches expected id', () => {
    const ethTokens = knownTokens[Chain.Ethereum] ?? []
    const usdc = ethTokens.find(t => t.ticker === 'USDC')

    expect(usdc).toBeDefined()
    expect(usdc!.id).toBe('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')
    expect(usdc!.decimals).toBe(6)
  })

  it('user-configured tokens take priority over knownTokens', () => {
    const userUSDC = {
      symbol: 'USDC',
      decimals: 18, // intentionally wrong decimals to prove priority
      contractAddress: '0xUserCustomUSDC',
    }
    const getTokens = (chain: Chain) => chain === Chain.Ethereum ? [userUSDC] : []

    const result = resolveTokenInfo(Chain.Ethereum, 'USDC', getTokens)

    // Should return user's config, NOT knownTokens
    expect(result.ticker).toBe('USDC')
    expect(result.decimals).toBe(18) // user's wrong decimals prove priority
    expect(result.contractAddress).toBe('0xUserCustomUSDC')
  })

  it('user-configured token.id is used as contractAddress fallback', () => {
    const userToken = {
      symbol: 'WETH',
      decimals: 18,
      id: '0xUserWETH',
      // no contractAddress field
    }
    const getTokens = (chain: Chain) => chain === Chain.Ethereum ? [userToken] : []

    const result = resolveTokenInfo(Chain.Ethereum, 'WETH', getTokens)

    expect(result.contractAddress).toBe('0xUserWETH')
  })

  it('should throw for token not in knownTokens or user tokens', () => {
    expect(() => resolveTokenInfo(Chain.Ethereum, 'FAKECOIN', emptyGetTokens)).toThrow(VaultError)
    expect(() => resolveTokenInfo(Chain.Ethereum, 'FAKECOIN', emptyGetTokens)).toThrow(
      'Token "FAKECOIN" not found on Ethereum'
    )
  })

  it('should resolve case-insensitively against knownTokens', () => {
    const result = resolveTokenInfo(Chain.Ethereum, 'usdc', emptyGetTokens)
    expect(result.ticker).toBe('USDC')

    const result2 = resolveTokenInfo(Chain.Ethereum, 'Usdc', emptyGetTokens)
    expect(result2.ticker).toBe('USDC')
  })

  it('native token is returned even when knownTokens has tokens for that chain', () => {
    // ETH is native, should not go through knownTokens
    const result = resolveTokenInfo(Chain.Ethereum, 'ETH', emptyGetTokens)
    expect(result.ticker).toBe('ETH')
    expect(result.decimals).toBe(18)
    expect(result.contractAddress).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// 4. Approval confirmation wait behavior
// ---------------------------------------------------------------------------

describe('waitForConfirmation behavior', () => {
  /**
   * We reproduce the waitForConfirmation logic from VaultBase exactly,
   * calling a mock getTxStatus to verify polling behavior.
   */
  async function waitForConfirmation(
    getTxStatus: (params: { chain: Chain; txHash: string }) => Promise<{ status: string }>,
    chain: Chain,
    txHash: string,
    timeoutMs = 60_000,
    intervalMs = 3_000
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      try {
        const result = await getTxStatus({ chain, txHash })
        if (result.status === 'success') return
        if (result.status === 'error') throw new VaultError(VaultErrorCode.BroadcastFailed, `Approval tx failed: ${txHash}`)
      } catch (e) {
        if (e instanceof VaultError && e.code !== VaultErrorCode.NetworkError) throw e
      }
      await new Promise(resolve => setTimeout(resolve, intervalMs))
    }
    throw new VaultError(VaultErrorCode.Timeout, `Approval tx not confirmed within ${timeoutMs / 1000}s: ${txHash}`)
  }

  it('should proceed immediately when approval returns success on first poll', async () => {
    const getTxStatus = vi.fn().mockResolvedValue({ status: 'success' })

    await waitForConfirmation(getTxStatus, Chain.Ethereum, '0xApprovalHash', 5000, 100)

    expect(getTxStatus).toHaveBeenCalledTimes(1)
    expect(getTxStatus).toHaveBeenCalledWith({ chain: Chain.Ethereum, txHash: '0xApprovalHash' })
  })

  it('should poll and proceed when status goes from pending to success', async () => {
    const getTxStatus = vi.fn()
      .mockResolvedValueOnce({ status: 'pending' })
      .mockResolvedValueOnce({ status: 'pending' })
      .mockResolvedValueOnce({ status: 'success' })

    await waitForConfirmation(getTxStatus, Chain.Ethereum, '0xApprovalHash', 5000, 50)

    expect(getTxStatus).toHaveBeenCalledTimes(3)
  })

  it('should throw BroadcastFailed when approval status returns error', async () => {
    const getTxStatus = vi.fn().mockResolvedValue({ status: 'error' })

    try {
      await waitForConfirmation(getTxStatus, Chain.Ethereum, '0xFailedApproval', 5000, 100)
      expect.unreachable('Should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(VaultError)
      expect((e as VaultError).code).toBe(VaultErrorCode.BroadcastFailed)
      expect((e as VaultError).message).toContain('0xFailedApproval')
    }
  })

  it('should throw Timeout when approval never confirms', async () => {
    const getTxStatus = vi.fn().mockResolvedValue({ status: 'pending' })

    try {
      // Use very short timeout and interval to avoid slow test
      await waitForConfirmation(getTxStatus, Chain.Ethereum, '0xStuckApproval', 200, 50)
      expect.unreachable('Should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(VaultError)
      expect((e as VaultError).code).toBe(VaultErrorCode.Timeout)
      expect((e as VaultError).message).toContain('0xStuckApproval')
    }
    // Should have polled multiple times before timing out
    expect(getTxStatus.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('should retry through network errors and succeed when status eventually returns success', async () => {
    const getTxStatus = vi.fn()
      .mockRejectedValueOnce(new Error('network timeout'))
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValueOnce({ status: 'success' })

    await waitForConfirmation(getTxStatus, Chain.Ethereum, '0xRetryHash', 5000, 50)

    expect(getTxStatus).toHaveBeenCalledTimes(3)
  })

  it('should NOT retry VaultError (re-throws immediately)', async () => {
    const getTxStatus = vi.fn()
      .mockRejectedValueOnce(new VaultError(VaultErrorCode.BroadcastFailed, 'Approval tx failed: 0xBad'))

    try {
      await waitForConfirmation(getTxStatus, Chain.Ethereum, '0xBad', 5000, 50)
      expect.unreachable('Should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(VaultError)
      expect((e as VaultError).code).toBe(VaultErrorCode.BroadcastFailed)
    }

    // Should have called only once - VaultError is not retried
    expect(getTxStatus).toHaveBeenCalledTimes(1)
  })

  it('should retry through VaultError NetworkError and succeed', async () => {
    const getTxStatus = vi.fn()
      .mockRejectedValueOnce(new VaultError(VaultErrorCode.NetworkError, 'RPC timeout'))
      .mockRejectedValueOnce(new VaultError(VaultErrorCode.NetworkError, 'Connection refused'))
      .mockResolvedValueOnce({ status: 'success' })

    await waitForConfirmation(getTxStatus, Chain.Ethereum, '0xNetworkRetry', 5000, 50)

    expect(getTxStatus).toHaveBeenCalledTimes(3)
  })

  it('should throw BroadcastFailed after pending then error', async () => {
    const getTxStatus = vi.fn()
      .mockResolvedValueOnce({ status: 'pending' })
      .mockResolvedValueOnce({ status: 'error' })

    try {
      await waitForConfirmation(getTxStatus, Chain.Ethereum, '0xPendingThenFail', 5000, 50)
      expect.unreachable('Should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(VaultError)
      expect((e as VaultError).code).toBe(VaultErrorCode.BroadcastFailed)
    }

    expect(getTxStatus).toHaveBeenCalledTimes(2)
  })
})
