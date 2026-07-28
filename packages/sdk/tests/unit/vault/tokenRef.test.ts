/**
 * Token-ref resolution.
 *
 * These tests drive the REAL `resolveTokenRef` / `resolveTokenRefId` and the
 * REAL `VaultBase.prototype.send` / `VaultBase.prototype.balance` bodies (via
 * `.call` with a minimal `this`, the pattern used by
 * VaultBase.balancesWithPrices.test.ts). Nothing that participates in
 * resolution is stubbed — only the network boundaries below it
 * (`prepareSendTx`, `estimateSendFee`, `balanceService.getBalance`), whose
 * arguments are what we assert on. Delete the resolution code and every
 * expectation here fails.
 */
import { Chain } from '@vultisig/core-chain/Chain'
import { knownTokens } from '@vultisig/core-chain/coin/knownTokens'
import { describe, expect, it, vi } from 'vitest'

import type { Token } from '../../../src/types'
import { resolveTokenRef, resolveTokenRefId } from '../../../src/vault/tokenRef'
import { VaultBase } from '../../../src/vault/VaultBase'
import { VaultError } from '../../../src/vault/VaultError'

// USDC on Ethereum: present in the well-known registry (checksummed id) AND, in
// the vault-store cases below, in the user's own token list (lowercase, exactly
// how `tokens --discover` writes it).
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
    // Address matching is case-insensitive: EIP-55 checksummed input must find
    // the lowercase entry that token discovery wrote.
    expect(resolveTokenRef(Chain.Ethereum, USDC_CHECKSUM, [storedUsdc])).toMatchObject({ ticker: 'USDC' })
  })

  it('resolves a user token by its stored id when that differs from contractAddress', () => {
    // `tokens --add` stores id as `<Chain>-<address>`.
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
    // A vault whose token list contains a token whose SYMBOL is another token's
    // address must still resolve that symbol to the symbol-matched entry.
    const decoy: Token = {
      id: '0x00000000000000000000000000000000000000aa',
      symbol: USDC_LOWER, // pathological, but proves the ordering
      name: 'decoy',
      decimals: 18,
      contractAddress: '0x00000000000000000000000000000000000000aa',
      chainId: Chain.Ethereum,
      isNative: false,
    }
    expect(resolveTokenRef(Chain.Ethereum, USDC_LOWER, [decoy, storedUsdc])).toMatchObject({ ticker: USDC_LOWER })

    // And a user token shadows the well-known registry entry for the same symbol.
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
    // Non-EVM asset ids that are in no registry must also survive untouched.
    expect(resolveTokenRefId(Chain.THORChain, 'x/staking/some-denom', [])).toBe('x/staking/some-denom')
  })
})

// ---------------------------------------------------------------------------
// The send path and the balance path must agree on what a ref means. Before
// this fix `send` read the ref as a symbol while `balance` read the SAME value
// as a raw contract address, so no `--token` value worked on both.
// ---------------------------------------------------------------------------

const proto = VaultBase.prototype as unknown as Record<string, (...args: never[]) => unknown>

/** Run the real `send` dry-run and report the coin it would have signed for. */
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

/** Run the real `balance` and report the token id it hands to the RPC layer. */
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
    // The heart of it: the contract address the send signs for is byte-identical
    // to the one the balance lookup queries. If these ever diverge again, the
    // preview reports one asset's balance for another asset's transfer.
    expect(balanceId).toBe(coin?.id)
  })

  it('a native send still resolves to the native coin with no token id on either path', async () => {
    const coin = await sendCoinFor('ETH', [storedUsdc])
    expect(coin).toMatchObject({ ticker: 'ETH', decimals: 18 })
    expect(coin?.id).toBeUndefined()
    expect(await balanceIdFor('ETH', [storedUsdc])).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Non-EVM chains. Their registry ids are denoms and mint addresses, not
// 0x-addresses, so the id-matching branch has to work on strings that look
// nothing like an EVM contract address.
// ---------------------------------------------------------------------------

describe('non-EVM token refs resolve on both paths', () => {
  it('resolves a Cosmos denom by id and by ticker to the same asset', () => {
    // MayaChain's registry keys `maya` (the denom) with ticker `MAYA`.
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
    // Same assertion as the EVM matrix: whatever the send path signs for is
    // exactly what the balance path queries.
    expect(resolveTokenRefId(Chain.Solana, mint.ticker, [])).toBe(info.contractAddress)
    expect(resolveTokenRefId(Chain.Solana, mint.id, [])).toBe(info.contractAddress)
  })
})
