import { Chain } from '@vultisig/core-chain/Chain'
import { knownTokens } from '@vultisig/core-chain/coin/knownTokens'
import { describe, expect, it, vi } from 'vitest'

import type { Token } from '../../../src/types'
import { resolveTokenRef, resolveTokenRefId } from '../../../src/vault/tokenRef'
import { VaultBase } from '../../../src/vault/VaultBase'
import { VaultError } from '../../../src/vault/VaultError'

const USDC_CHECKSUM = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const USDC_LOWER = USDC_CHECKSUM.toLowerCase()

const storedUsdc: Token = {
  id: USDC_LOWER,
  symbol: 'USDC',
  name: 'USDC',
  decimals: 6,
  contractAddress: USDC_LOWER,
  chainId: Chain.Ethereum,
  isNative: false,
}

describe('resolveTokenRef', () => {
  it('resolves the native asset for an omitted ref and for the native ticker', () => {
    expect(resolveTokenRef(Chain.Ethereum, undefined, [])).toEqual({ ticker: 'ETH', decimals: 18 })
    expect(resolveTokenRef(Chain.Ethereum, 'eth', [])).toEqual({ ticker: 'ETH', decimals: 18 })
    expect(resolveTokenRef(Chain.Bitcoin, undefined, [])).toMatchObject({ ticker: 'BTC' })
  })

  it('resolves a user token by symbol (case-insensitive) — pre-existing behaviour', () => {
    expect(resolveTokenRef(Chain.Ethereum, 'USDC', [storedUsdc])).toEqual({
      ticker: 'USDC',
      decimals: 6,
      contractAddress: USDC_LOWER,
    })
    expect(resolveTokenRef(Chain.Ethereum, 'usdc', [storedUsdc])).toMatchObject({ contractAddress: USDC_LOWER })
  })

  it('resolves a user token by contract address — the case that used to throw', () => {
    expect(resolveTokenRef(Chain.Ethereum, USDC_LOWER, [storedUsdc])).toEqual({
      ticker: 'USDC',
      decimals: 6,
      contractAddress: USDC_LOWER,
    })
    expect(resolveTokenRef(Chain.Ethereum, USDC_CHECKSUM, [storedUsdc])).toMatchObject({ ticker: 'USDC' })
  })

  it('resolves a user token with no symbol by contract address and returns a defined ticker', () => {
    const malformed = { ...storedUsdc, symbol: undefined } as unknown as Token

    expect(() => resolveTokenRef(Chain.Ethereum, USDC_CHECKSUM, [malformed])).not.toThrow()
    expect(resolveTokenRef(Chain.Ethereum, USDC_CHECKSUM, [malformed])).toEqual({
      ticker: USDC_LOWER,
      decimals: 6,
      contractAddress: USDC_LOWER,
    })
  })

  it('resolves a well-formed token by symbol when a malformed sibling is present', () => {
    const malformed = {
      ...storedUsdc,
      id: '0x00000000000000000000000000000000000000aa',
      symbol: undefined,
      contractAddress: '0x00000000000000000000000000000000000000aa',
    } as unknown as Token

    expect(resolveTokenRef(Chain.Ethereum, 'USDC', [malformed, storedUsdc])).toEqual({
      ticker: 'USDC',
      decimals: 6,
      contractAddress: USDC_LOWER,
    })
  })

  it('resolves a user token by its stored id when that differs from contractAddress', () => {
    const added: Token = { ...storedUsdc, id: `${Chain.Ethereum}-${USDC_LOWER}` }
    expect(resolveTokenRef(Chain.Ethereum, `${Chain.Ethereum}-${USDC_LOWER}`, [added])).toMatchObject({
      ticker: 'USDC',
      contractAddress: USDC_LOWER,
    })
  })

  it('falls back to the well-known registry by ticker — pre-existing behaviour', () => {
    expect(resolveTokenRef(Chain.Ethereum, 'USDC', [])).toEqual({
      ticker: 'USDC',
      decimals: 6,
      contractAddress: USDC_CHECKSUM,
    })
  })

  it('falls back to the well-known registry by contract address — the other case that used to throw', () => {
    expect(resolveTokenRef(Chain.Ethereum, USDC_LOWER, [])).toEqual({
      ticker: 'USDC',
      decimals: 6,
      contractAddress: USDC_CHECKSUM,
    })
  })

  it('prefers a symbol match over an address match, and user tokens over the registry', () => {
    const decoy: Token = {
      id: '0x00000000000000000000000000000000000000aa',
      symbol: USDC_LOWER,
      name: 'decoy',
      decimals: 18,
      contractAddress: '0x00000000000000000000000000000000000000aa',
      chainId: Chain.Ethereum,
      isNative: false,
    }
    expect(resolveTokenRef(Chain.Ethereum, USDC_LOWER, [decoy, storedUsdc])).toMatchObject({ ticker: USDC_LOWER })

    const custom: Token = { ...storedUsdc, contractAddress: '0x00000000000000000000000000000000000000bb', decimals: 8 }
    expect(resolveTokenRef(Chain.Ethereum, 'USDC', [custom])).toMatchObject({
      decimals: 8,
      contractAddress: '0x00000000000000000000000000000000000000bb',
    })
  })

  it('throws a VaultError naming the ref when nothing matches', () => {
    expect(() => resolveTokenRef(Chain.Ethereum, 'NOPE', [])).toThrow(VaultError)
    expect(() => resolveTokenRef(Chain.Ethereum, 'NOPE', [])).toThrow(/Token "NOPE" not found on Ethereum/)
  })
})

describe('resolveTokenRefId', () => {
  it('returns undefined for the native asset so the balance layer fetches the native balance', () => {
    expect(resolveTokenRefId(Chain.Ethereum, undefined, [])).toBeUndefined()
    expect(resolveTokenRefId(Chain.Ethereum, 'ETH', [])).toBeUndefined()
  })

  it('maps a symbol to its contract address', () => {
    expect(resolveTokenRefId(Chain.Ethereum, 'USDC', [storedUsdc])).toBe(USDC_LOWER)
    expect(resolveTokenRefId(Chain.Ethereum, 'USDC', [])).toBe(USDC_CHECKSUM)
  })

  it('passes an unrecognised ref through unchanged (raw contract addresses keep working)', () => {
    const unknown = '0x00000000000000000000000000000000000000ff'
    expect(resolveTokenRefId(Chain.Ethereum, unknown, [])).toBe(unknown)
    expect(resolveTokenRefId(Chain.THORChain, 'x/staking/some-denom', [])).toBe('x/staking/some-denom')
  })
})

const proto = VaultBase.prototype as unknown as Record<string, (...args: never[]) => unknown>

async function sendCoinFor(ref: string, tokens: Token[]) {
  let coin: { ticker: string; decimals: number; id?: string } | undefined
  const vault = {
    _tokens: { [Chain.Ethereum]: tokens },
    getTokens: proto.getTokens,
    resolveTokenInfo: proto.resolveTokenInfo,
    buildAccountCoin: proto.buildAccountCoin,
    parseAmount: proto.parseAmount,
    formatUnits: proto.formatUnits,
    address: async () => '0x58C4a1F319297EC9c398A0F3a3b64AF5a18b5C35',
    prepareSendTx: async (params: { coin: typeof coin }) => {
      coin = params.coin
      return {}
    },
    transactionBuilder: { estimateSendFee: async () => 21000n },
  }
  await (proto.send as unknown as (this: unknown, p: unknown) => Promise<unknown>).call(vault, {
    chain: Chain.Ethereum,
    to: '0x1111111111111111111111111111111111111111',
    amount: '0.01',
    symbol: ref,
    dryRun: true,
  })
  return coin
}

async function balanceIdFor(ref: string, tokens: Token[]) {
  const getBalance = vi.fn().mockResolvedValue({})
  const vault = {
    _tokens: { [Chain.Ethereum]: tokens },
    getTokens: proto.getTokens,
    balanceService: { getBalance },
  }
  await (proto.balance as unknown as (this: unknown, c: Chain, t?: string) => Promise<unknown>).call(
    vault,
    Chain.Ethereum,
    ref
  )
  return getBalance.mock.calls[0][1] as string | undefined
}

async function updateBalanceIdFor(ref: string, tokens: Token[]) {
  const updateBalance = vi.fn().mockResolvedValue({})
  const vault = {
    _tokens: { [Chain.Ethereum]: tokens },
    getTokens: proto.getTokens,
    balanceService: { updateBalance },
  }
  await (proto.updateBalance as unknown as (this: unknown, c: Chain, t?: string) => Promise<unknown>).call(
    vault,
    Chain.Ethereum,
    ref
  )
  return updateBalance.mock.calls[0][1] as string | undefined
}

describe('send and balance resolve a token ref identically', () => {
  const cases: Array<[string, string, Token[]]> = [
    ['symbol, token in the vault store', 'USDC', [storedUsdc]],
    ['contract address, token in the vault store', USDC_LOWER, [storedUsdc]],
    ['checksummed address, token in the vault store', USDC_CHECKSUM, [storedUsdc]],
    ['symbol, well-known registry only', 'USDC', []],
    ['contract address, well-known registry only', USDC_LOWER, []],
  ]

  it.each(cases)('%s', async (_name, ref, tokens) => {
    const coin = await sendCoinFor(ref, tokens)
    const balanceId = await balanceIdFor(ref, tokens)

    expect(coin).toMatchObject({ ticker: 'USDC', decimals: 6 })
    expect(coin?.id).toBeDefined()
    expect(balanceId).toBe(coin?.id)
  })

  it('a native send still resolves to the native coin with no token id on either path', async () => {
    const coin = await sendCoinFor('ETH', [storedUsdc])
    expect(coin).toMatchObject({ ticker: 'ETH', decimals: 18 })
    expect(coin?.id).toBeUndefined()
    expect(await balanceIdFor('ETH', [storedUsdc])).toBeUndefined()
  })

  it('updateBalance refreshes the same resolved token id as balance', async () => {
    expect(await balanceIdFor('USDC', [storedUsdc])).toBe(USDC_LOWER)
    expect(await updateBalanceIdFor('USDC', [storedUsdc])).toBe(USDC_LOWER)
  })
})

describe('non-EVM token refs resolve on both paths', () => {
  it('resolves a Cosmos denom by id and by ticker to the same asset', () => {
    const byTicker = resolveTokenRef(Chain.MayaChain, 'MAYA', [])
    const byDenom = resolveTokenRef(Chain.MayaChain, 'maya', [])
    expect(byTicker).toEqual(byDenom)
    expect(byTicker.contractAddress).toBe('maya')
  })

  it('resolves a Solana mint address by id', () => {
    const known = knownTokens[Chain.Solana] ?? []
    const mint = known[0]
    expect(mint).toBeDefined()
    expect(resolveTokenRef(Chain.Solana, mint.id, [])).toMatchObject({
      ticker: mint.ticker,
      decimals: mint.decimals,
      contractAddress: mint.id,
    })
  })

  it('keeps send and balance in agreement for a non-EVM ref', async () => {
    const known = knownTokens[Chain.Solana] ?? []
    const mint = known[0]
    const info = resolveTokenRef(Chain.Solana, mint.ticker, [])
    expect(resolveTokenRefId(Chain.Solana, mint.ticker, [])).toBe(info.contractAddress)
    expect(resolveTokenRefId(Chain.Solana, mint.id, [])).toBe(info.contractAddress)
  })
})
