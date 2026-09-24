import { Chain } from '@vultisig/core-chain/Chain'
import { knownTokens } from '@vultisig/core-chain/coin/knownTokens'
import { describe, expect, it, vi } from 'vitest'

import type { Token } from '../../../src/types'
import { resolveTokenRef, resolveTokenRefId } from '../../../src/vault/tokenRef'
import { VaultBase } from '../../../src/vault/VaultBase'
import { VaultError } from '../../../src/vault/VaultError'

const USDC_CHECKSUM = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const USDC_LOWER = USDC_CHECKSUM.toLowerCase()
const IMPOSTOR_USDC = '0x00000000000000000000000000000000000000ff'

const storedUsdc: Token = {
  id: USDC_LOWER,
  symbol: 'USDC',
  name: 'USDC',
  decimals: 6,
  contractAddress: USDC_LOWER,
  chainId: Chain.Ethereum,
  isNative: false,
}

const impostorUsdc: Token = {
  ...storedUsdc,
  id: IMPOSTOR_USDC,
  contractAddress: IMPOSTOR_USDC,
  name: 'Airdropped USDC lookalike',
  decimals: 18,
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

  it('resolves a legacy prefixed id by both its stored and bare forms', () => {
    const customAddress = '0x00000000000000000000000000000000000000ff'
    const legacy = {
      ...storedUsdc,
      id: `${Chain.Ethereum}-${customAddress}`,
      contractAddress: undefined,
    } as Token

    for (const ref of [legacy.id, customAddress]) {
      expect(resolveTokenRef(Chain.Ethereum, ref, [legacy])).toMatchObject({
        ticker: 'USDC',
        contractAddress: customAddress,
      })
    }
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

  it('prefers an address identity over a poisoned symbol, and user tokens over the registry', () => {
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
    expect(resolveTokenRef(Chain.Ethereum, USDC_CHECKSUM, [decoy, storedUsdc]).contractAddress).toBe(USDC_LOWER)
    expect(resolveTokenRef(Chain.Ethereum, USDC_LOWER, [decoy]).contractAddress).toBe(USDC_CHECKSUM)

    const custom: Token = { ...storedUsdc, contractAddress: '0x00000000000000000000000000000000000000bb', decimals: 8 }
    expect(resolveTokenRef(Chain.Ethereum, 'USDC', [custom])).toMatchObject({
      decimals: 8,
      contractAddress: '0x00000000000000000000000000000000000000bb',
    })
  })

  it('does not resolve an address through a stored id for a different contract', () => {
    const conflicting = { ...impostorUsdc, id: USDC_LOWER, symbol: 'IMPOSTOR' }

    expect(resolveTokenRef(Chain.Ethereum, USDC_LOWER, [conflicting, storedUsdc])).toMatchObject({
      ticker: 'USDC',
      contractAddress: USDC_LOWER,
    })
    expect(resolveTokenRef(Chain.Ethereum, USDC_LOWER, [conflicting])).toMatchObject({
      ticker: 'USDC',
      contractAddress: USDC_CHECKSUM,
    })
  })

  it('never resolves an unknown address through a same-text symbol', () => {
    const unknown = '0x00000000000000000000000000000000000000ab'
    const decoy = { ...impostorUsdc, symbol: unknown }
    expect(() => resolveTokenRef(Chain.Ethereum, unknown, [decoy])).toThrow(/not found/)
    expect(resolveTokenRefId(Chain.Ethereum, unknown, [decoy])).toBe(unknown)
  })

  it('prefers short stored and registry IDs over poisoned symbols', () => {
    const decoy = { ...storedUsdc, id: '9999', contractAddress: '9999', symbol: '1984', chainId: Chain.Polkadot }
    const genuine = { ...decoy, id: '1984', contractAddress: '1984', symbol: 'USDT', decimals: 6 }

    expect(resolveTokenRef(Chain.Polkadot, '1984', [decoy, genuine])).toMatchObject({
      ticker: 'USDT',
      contractAddress: '1984',
    })
    expect(resolveTokenRef(Chain.Polkadot, '1984', [decoy])).toMatchObject({
      ticker: 'USDT',
      contractAddress: '1984',
    })
    expect(() => resolveTokenRef(Chain.Polkadot, '9998', [{ ...decoy, symbol: '9998' }])).toThrow(/not found/)
    expect(resolveTokenRef(Chain.Polkadot, `${Chain.Polkadot}-1984`, [decoy, genuine]).contractAddress).toBe('1984')
  })

  it('resolves a non-EVM stored ID ahead of a same-text symbol', () => {
    const mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    const decoy = {
      ...storedUsdc,
      chainId: Chain.Solana,
      id: 'AnotherMintId',
      contractAddress: 'AnotherMintId',
      symbol: mint,
    }
    const genuine = { ...decoy, id: mint, contractAddress: mint, symbol: 'USDC' }

    expect(resolveTokenRef(Chain.Solana, mint, [decoy, genuine]).contractAddress).toBe(mint)
    expect(resolveTokenRef(Chain.Solana, mint, [decoy]).contractAddress).toBe(mint)
    const unknownMint = 'ePjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    expect(() => resolveTokenRef(Chain.Solana, unknownMint, [{ ...decoy, symbol: unknownMint }])).toThrow(/not found/)
  })

  it('keeps slash-bearing THORChain tickers while rejecting unmatched denom-shaped refs', () => {
    const ticker = 'ATOM/USDC.ETH'
    const poolId = 'x/bow-xyk-gaia-atom-eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
    const pool = { ...storedUsdc, chainId: Chain.THORChain, id: poolId, contractAddress: poolId, symbol: ticker }
    expect(resolveTokenRef(Chain.THORChain, ticker, [pool]).contractAddress).toBe(poolId)

    const poisoned = { ...storedUsdc, chainId: Chain.THORChain, symbol: 'x/staking/missing' }
    expect(() => resolveTokenRef(Chain.THORChain, 'x/staking/missing', [poisoned])).toThrow(/not found/)
    expect(() => resolveTokenRef(Chain.THORChain, 'thor.evil', [{ ...poisoned, symbol: 'thor.evil' }])).toThrow(
      /not found/
    )
    for (const ref of ['btc-btc', 'eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48']) {
      expect(() => resolveTokenRef(Chain.THORChain, ref, [{ ...poisoned, symbol: ref }])).toThrow(/not found/)
    }
  })

  it.each(['ABCDEFGHIJKLMNOPQRSTU', 'ABCDEFGHIJKLMNOPQRSTU2', 'LONG-TOKEN-SYMBOL-123'])(
    'resolves long ordinary symbol %s without token-ID syntax',
    longSymbol => {
      expect(resolveTokenRef(Chain.Ethereum, longSymbol, [{ ...storedUsdc, symbol: longSymbol }])).toMatchObject({
        ticker: longSymbol,
        contractAddress: USDC_LOWER,
      })
    }
  )

  it.each([
    [Chain.Ton, `EQ${'A'.repeat(46)}`],
    [Chain.Ton, `0:${'a'.repeat(64)}`],
    [Chain.Cosmos, 'factory/osmo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq/ufoo'],
    [Chain.Cardano, `${'a'.repeat(56)}.4d494c4b`],
  ])('does not resolve an absent %s identity via a same-text symbol', (chain, ref) => {
    const poisoned = {
      ...storedUsdc,
      chainId: chain,
      id: 'another-token',
      contractAddress: 'another-token',
      symbol: ref,
    }
    expect(() => resolveTokenRef(chain, ref, [poisoned])).toThrow(/not found/)
  })

  it('throws a VaultError naming the ref when nothing matches', () => {
    expect(() => resolveTokenRef(Chain.Ethereum, 'NOPE', [])).toThrow(VaultError)
    expect(() => resolveTokenRef(Chain.Ethereum, 'NOPE', [])).toThrow(/Token "NOPE" not found on Ethereum/)
  })

  it('treats case-variant Solana mint ids as distinct ambiguous assets', () => {
    const firstMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    const secondMint = 'ePjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    const tokens: Token[] = [
      { ...storedUsdc, id: firstMint, contractAddress: firstMint, chainId: Chain.Solana, symbol: 'WIDGET' },
      { ...storedUsdc, id: secondMint, contractAddress: secondMint, chainId: Chain.Solana, symbol: 'WIDGET' },
    ]

    expect(() => resolveTokenRef(Chain.Solana, 'WIDGET', tokens)).toThrow(/ambiguous.*contract address/i)
    expect(() => resolveTokenRefId(Chain.Solana, 'WIDGET', tokens)).toThrow(/ambiguous.*contract address/i)
    expect(resolveTokenRef(Chain.Solana, secondMint, tokens).contractAddress).toBe(secondMint)
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

async function sendPreparationFor(ref: string, tokens: Token[], chain: Chain = Chain.Ethereum) {
  let coin: { ticker: string; decimals: number; id?: string } | undefined
  let amount: bigint | undefined
  const address = addressFor[chain]
  const vault = {
    _tokens: { [chain]: tokens },
    getTokens: proto.getTokens,
    resolveTokenInfo: proto.resolveTokenInfo,
    buildAccountCoin: proto.buildAccountCoin,
    parseAmount: proto.parseAmount,
    formatUnits: proto.formatUnits,
    address: async () => address,
    prepareSendTx: async (params: { coin: typeof coin; amount: bigint }) => {
      coin = params.coin
      amount = params.amount
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
  return { coin, amount }
}

async function sendCoinFor(ref: string, tokens: Token[], chain: Chain = Chain.Ethereum) {
  return (await sendPreparationFor(ref, tokens, chain)).coin
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

  it('fails closed before a send when one symbol names distinct contracts', async () => {
    const tokens = [impostorUsdc, storedUsdc]

    await expect(sendCoinFor('USDC', tokens)).rejects.toThrow(/ambiguous.*contract address/i)
    expect(() => resolveTokenRefId(Chain.Ethereum, 'USDC', tokens)).toThrow(/ambiguous.*contract address/i)
  })

  it('still resolves either contract address in an ambiguous-symbol vault', async () => {
    const tokens = [impostorUsdc, storedUsdc]

    await expect(sendCoinFor(USDC_CHECKSUM, tokens)).resolves.toMatchObject({
      ticker: 'USDC',
      decimals: 6,
      id: USDC_LOWER,
    })
    await expect(sendCoinFor(IMPOSTOR_USDC, tokens)).resolves.toMatchObject({
      ticker: 'USDC',
      decimals: 18,
      id: IMPOSTOR_USDC,
    })
  })

  it('prepares a poisoned-vault dry run with the real contract and six-decimal amount', async () => {
    const decoy = { ...impostorUsdc, symbol: USDC_LOWER }
    const tokens = [decoy, storedUsdc]
    const { coin, amount } = await sendPreparationFor(USDC_CHECKSUM, tokens)

    expect(coin).toMatchObject({ ticker: 'USDC', decimals: 6, id: USDC_LOWER })
    expect(amount).toBe(10_000n)
    expect(await balanceIdFor(USDC_CHECKSUM, tokens)).toBe(coin?.id)
    expect((await sendPreparationFor(USDC_LOWER, [decoy])).coin).toMatchObject({
      ticker: 'USDC',
      decimals: 6,
      id: USDC_CHECKSUM,
    })
    expect(await balanceIdFor(USDC_LOWER, [decoy])).toBe(USDC_CHECKSUM)
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
