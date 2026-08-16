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

  it('prefers user tokens over the registry, and an ADDRESS ref over a symbol (sdk#1634)', () => {
    // This case previously asserted the opposite — that a `decoy` whose SYMBOL is
    // real USDC's address wins when the user types that address. That is the
    // spoofing surface sdk#1634 reports, so the expectation is inverted here: the
    // decoy must NOT capture the ref, and the token actually AT that address wins.
    const decoy: Token = {
      id: '0x00000000000000000000000000000000000000aa',
      symbol: USDC_LOWER,
      name: 'decoy',
      decimals: 18,
      contractAddress: '0x00000000000000000000000000000000000000aa',
      chainId: Chain.Ethereum,
      isNative: false,
    }
    expect(resolveTokenRef(Chain.Ethereum, USDC_LOWER, [decoy, storedUsdc])).toMatchObject({
      ticker: 'USDC',
      decimals: 6,
      contractAddress: USDC_LOWER,
    })

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

/**
 * Sender / recipient fixtures. Token resolution never inspects either address —
 * they are carried onto the coin and handed to the (stubbed) tx builder — but
 * using the right shape per chain keeps the fixture honest about what it models.
 */
const addressFor: Partial<Record<Chain, string>> = {
  [Chain.Ethereum]: '0x58C4a1F319297EC9c398A0F3a3b64AF5a18b5C35',
  [Chain.THORChain]: 'thor149ekc6vu5ez775hd7y7ukgdq86e43t88pk7njm',
  [Chain.Solana]: '5QXePTiaWgmqSCHh9YDWAiVvEeKWaM5cUN62K4SXwUSB',
}

async function sendCoinFor(ref: string, tokens: Token[], chain: Chain = Chain.Ethereum) {
  let coin: { ticker: string; decimals: number; id?: string } | undefined
  const address = addressFor[chain]
  const vault = {
    _tokens: { [chain]: tokens },
    getTokens: proto.getTokens,
    resolveTokenInfo: proto.resolveTokenInfo,
    buildAccountCoin: proto.buildAccountCoin,
    parseAmount: proto.parseAmount,
    formatUnits: proto.formatUnits,
    address: async () => address,
    prepareSendTx: async (params: { coin: typeof coin }) => {
      coin = params.coin
      return {}
    },
    transactionBuilder: { estimateSendFee: async () => 21000n },
  }
  await (proto.send as unknown as (this: unknown, p: unknown) => Promise<unknown>).call(vault, {
    chain,
    to: address,
    amount: '0.01',
    symbol: ref,
    dryRun: true,
  })
  return coin
}

async function balanceIdFor(ref: string, tokens: Token[], chain: Chain = Chain.Ethereum) {
  const getBalance = vi.fn().mockResolvedValue({})
  const vault = {
    _tokens: { [chain]: tokens },
    getTokens: proto.getTokens,
    balanceService: { getBalance },
  }
  await (proto.balance as unknown as (this: unknown, c: Chain, t?: string) => Promise<unknown>).call(vault, chain, ref)
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

/**
 * Pick a registry token whose id is genuinely distinct from its ticker.
 *
 * `resolveTokenRef` upper-cases the ref and matches tickers *before* ids, so a
 * token whose id is only its ticker in another case — MayaChain's `maya` /
 * `MAYA`, THORChain's `tcy` / `TCY` — resolves on the ticker branch no matter
 * which of the two you pass. Such a token cannot exercise id matching at all:
 * a test built on one passes just as happily with the id lookup deleted.
 *
 * The ticker must also be unique on the chain, or the ticker branch could land
 * on a different token than the id branch and the agreement assertions would be
 * comparing two unrelated assets.
 */
function tokenWithDistinctId(chain: Chain) {
  const known = knownTokens[chain] ?? []
  const token = known.find(
    (t): t is typeof t & { id: string } =>
      t.id !== undefined &&
      t.id.toLowerCase() !== t.ticker.toLowerCase() &&
      known.filter(other => other.ticker.toUpperCase() === t.ticker.toUpperCase()).length === 1
  )
  if (!token) throw new Error(`no known token on ${chain} whose id differs from its ticker`)
  return token
}

describe('non-EVM token refs resolve on both paths', () => {
  it('resolves a Cosmos denom by ticker', () => {
    // `maya` and `MAYA` both land on the ticker branch — this covers ticker
    // input for a Cosmos denom, and nothing more. See tokenWithDistinctId.
    expect(resolveTokenRef(Chain.MayaChain, 'MAYA', [])).toMatchObject({ ticker: 'MAYA', contractAddress: 'maya' })
  })

  it.each([Chain.THORChain, Chain.Solana])('resolves a %s token by id and by ticker to the same asset', chain => {
    const token = tokenWithDistinctId(chain)
    const expected = { ticker: token.ticker, decimals: token.decimals, contractAddress: token.id }

    expect(resolveTokenRef(chain, token.id, [])).toEqual(expected)
    expect(resolveTokenRef(chain, token.ticker, [])).toEqual(expected)
  })

  it.each([Chain.THORChain, Chain.Solana])(
    'keeps send() and balance() in agreement for a %s ref, by id and by ticker',
    async chain => {
      const token = tokenWithDistinctId(chain)

      for (const ref of [token.id, token.ticker]) {
        const coin = await sendCoinFor(ref, [], chain)
        const balanceId = await balanceIdFor(ref, [], chain)

        expect(coin).toMatchObject({ ticker: token.ticker, decimals: token.decimals, id: token.id })
        expect(balanceId).toBe(coin?.id)
      }
    }
  )
})

// --- sdk#1634: address-shaped refs must never be captured by a symbol -----------
//
// Vault token symbols are attacker-controlled strings persisted from on-chain
// discovery. A scam token whose `symbol` is set to the LITERAL TEXT of real USDC's
// contract address could capture a send in which the victim typed that genuine
// address correctly — resolving decimals, amount and the keysign target to the
// scam contract.

const poisoned: Token = {
  id: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
  // The attack: the symbol field IS real USDC's address.
  symbol: USDC_CHECKSUM,
  name: 'Airdrop',
  decimals: 18,
  contractAddress: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
  chainId: Chain.Ethereum,
  isNative: false,
}

describe('resolveTokenRef address-shaped refs (sdk#1634)', () => {
  it('resolves the REAL token when the victim also holds it', () => {
    const resolved = resolveTokenRef(Chain.Ethereum, USDC_CHECKSUM, [poisoned, storedUsdc])
    expect(resolved.contractAddress?.toLowerCase()).toBe(USDC_LOWER)
    expect(resolved.decimals).toBe(6)
  })

  it('does NOT fall back to the poisoned symbol when the real token is absent', () => {
    // The sharp case: with a symbol fallback, a victim who does not already hold
    // real USDC still resolves to the scam contract. It must fail or reach the
    // curated registry — never an attacker-named symbol.
    const resolved = resolveTokenRef(Chain.Ethereum, USDC_CHECKSUM, [poisoned])
    expect(resolved.contractAddress?.toLowerCase()).not.toBe(poisoned.contractAddress)
    expect(resolved.decimals).not.toBe(18)
  })

  it('is order-independent (the poisoned token first does not win)', () => {
    const a = resolveTokenRef(Chain.Ethereum, USDC_CHECKSUM, [poisoned, storedUsdc])
    const b = resolveTokenRef(Chain.Ethereum, USDC_CHECKSUM, [storedUsdc, poisoned])
    expect(a).toEqual(b)
  })

  it('still resolves a plain ticker ref by symbol (no regression)', () => {
    expect(resolveTokenRef(Chain.Ethereum, 'usdc', [storedUsdc])).toMatchObject({ ticker: 'USDC', decimals: 6 })
  })

  it('treats long non-hex refs as addresses too (Solana mint shape)', () => {
    const splMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    const poisonedSpl: Token = { ...poisoned, symbol: splMint }
    // The poisoned symbol must not capture it. This mint IS in the curated
    // registry, so it correctly falls through to real USDC (6 decimals) rather
    // than the scam token's 18 — which is the outcome that matters.
    const resolved = resolveTokenRef(Chain.Solana, splMint, [poisonedSpl])
    expect(resolved).toMatchObject({ ticker: 'USDC', decimals: 6 })
    expect(resolved.contractAddress?.toLowerCase()).not.toBe(poisonedSpl.contractAddress?.toLowerCase())
  })

  it('an address-shaped ref matching nothing at all still throws', () => {
    const unknown = '0x' + 'ab'.repeat(20)
    expect(() => resolveTokenRef(Chain.Ethereum, unknown, [poisoned])).toThrow(VaultError)
  })
})
