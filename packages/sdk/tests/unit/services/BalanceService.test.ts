import { Chain } from '@vultisig/core-chain/Chain'
import { rippleTokenId } from '@vultisig/core-chain/chains/ripple/issuedCurrency'
import { accountCoinKeyToString } from '@vultisig/core-chain/coin/AccountCoin'
import { getCoinBalance } from '@vultisig/core-chain/coin/balance'
import { getEvmChainBalances } from '@vultisig/core-chain/coin/balance/getEvmChainBalances'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CacheScope, CacheService } from '../../../src/services/CacheService'
import { MemoryStorage } from '../../../src/storage/MemoryStorage'
import type { Token } from '../../../src/types'
import { BalanceService } from '../../../src/vault/services/BalanceService'
import { VaultBase } from '../../../src/vault/VaultBase'

vi.mock('@vultisig/core-chain/coin/balance', () => ({
  getCoinBalance: vi.fn(),
}))

vi.mock('@vultisig/core-chain/coin/balance/getEvmChainBalances', () => ({
  getEvmChainBalances: vi.fn(),
}))

const token: Token = {
  id: '0x00000000000000000000000000000000000000aa',
  symbol: 'USDC',
  name: 'USD Coin',
  decimals: 6,
  chainId: Chain.Ethereum,
}

const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
const addedToken: Token = {
  id: `${Chain.Ethereum}-${USDC}`,
  contractAddress: USDC,
  symbol: 'USDC',
  name: 'USD Coin',
  decimals: 6,
  chainId: Chain.Ethereum,
  isNative: false,
}

const COLLISION_ASSET_A = '0x00000000000000000000000000000000000000aa'
const COLLISION_ASSET_B = '0x00000000000000000000000000000000000000bb'
const collisionTokenA: Token = {
  id: COLLISION_ASSET_A,
  contractAddress: COLLISION_ASSET_A,
  symbol: 'ALPHA',
  name: 'Alpha',
  decimals: 6,
  chainId: Chain.Ethereum,
  isNative: false,
}
const collisionTokenB: Token = {
  id: COLLISION_ASSET_B,
  contractAddress: COLLISION_ASSET_B,
  symbol: COLLISION_ASSET_A,
  name: 'Address-shaped symbol',
  decimals: 6,
  chainId: Chain.Ethereum,
  isNative: false,
}

const flushMicrotasks = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

describe('BalanceService', () => {
  let cacheService: CacheService

  beforeEach(() => {
    cacheService = new CacheService(new MemoryStorage(), 'balance-service-test')
    vi.clearAllMocks()
  })

  const makeService = () =>
    new BalanceService(
      cacheService,
      vi.fn(),
      vi.fn(),
      async chain => `${chain}-address`,
      chain => (chain === Chain.Ethereum ? [token] : []),
      () => ({ [Chain.Ethereum]: [token] }),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn()
    )

  const makeMutableService = (initialTokens: Token[] = []) => {
    let allTokens: Record<string, Token[]> = { [Chain.Ethereum]: [...initialTokens] }
    const saveVault = vi.fn(async () => {})
    const emitTokenRemoved = vi.fn()
    const service = new BalanceService(
      cacheService,
      vi.fn(),
      vi.fn(),
      async chain => `${chain}-address`,
      chain => allTokens[chain] ?? [],
      () => allTokens,
      tokens => {
        allTokens = tokens
      },
      saveVault,
      vi.fn(),
      emitTokenRemoved
    )

    return {
      service,
      saveVault,
      emitTokenRemoved,
      getTokens: (chain: Chain) => allTokens[chain] ?? [],
    }
  }

  const makeReadService = (tokens: Token[]) =>
    new BalanceService(
      cacheService,
      vi.fn(),
      vi.fn(),
      async chain => `${chain}-address`,
      chain => (chain === Chain.Ethereum ? tokens : []),
      () => ({ [Chain.Ethereum]: tokens }),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn()
    )

  it("does not reinterpret a canonical asset id as another token's symbol", async () => {
    vi.mocked(getCoinBalance).mockImplementation(async ({ id }) => {
      if (id === COLLISION_ASSET_A) return 5_000_000n
      if (id === COLLISION_ASSET_B) return 1_000_000n
      return 0n
    })
    const service = makeReadService([collisionTokenA, collisionTokenB])

    const balance = await service.getBalance(Chain.Ethereum, COLLISION_ASSET_A)

    expect(getCoinBalance).toHaveBeenCalledWith({
      chain: Chain.Ethereum,
      address: `${Chain.Ethereum}-address`,
      id: COLLISION_ASSET_A,
    })
    expect(balance.amount).toBe('5000000')
  })

  it("derives a max swap amount from the selected asset when a sibling's symbol matches its id", async () => {
    vi.mocked(getCoinBalance).mockImplementation(async ({ id }) => {
      if (id === COLLISION_ASSET_A) return 5_000_000n
      if (id === COLLISION_ASSET_B) return 1_000_000n
      return 0n
    })
    const service = makeReadService([collisionTokenA, collisionTokenB])
    const proto = VaultBase.prototype as unknown as Record<string, (...args: never[]) => unknown>
    const getSwapQuote = vi.fn().mockResolvedValue({ provider: 'test', maxSwapable: 5_000_000n })
    const vault = {
      _tokens: { [Chain.Ethereum]: [collisionTokenA, collisionTokenB] },
      getTokens: proto.getTokens,
      resolveTokenInfo: proto.resolveTokenInfo,
      buildAccountCoin: proto.buildAccountCoin,
      formatUnits: proto.formatUnits,
      validateHumanSwapAmount: proto.validateHumanSwapAmount,
      address: async (chain: Chain) => `${chain}-address`,
      balanceService: service,
      getSwapQuote,
    }

    await (proto.swap as unknown as (this: unknown, params: unknown) => Promise<unknown>).call(vault, {
      fromChain: Chain.Ethereum,
      fromSymbol: collisionTokenA.symbol,
      toChain: Chain.Bitcoin,
      toSymbol: 'BTC',
      amount: 'max',
      dryRun: true,
    })

    expect(getCoinBalance).toHaveBeenCalledWith(expect.objectContaining({ id: COLLISION_ASSET_A }))
    expect(getSwapQuote).toHaveBeenCalledWith(
      expect.objectContaining({
        fromCoin: expect.objectContaining({ id: COLLISION_ASSET_A }),
        amount: '5.0',
      })
    )
  })

  it('keeps an EVM chain in --tokens results with a legacy prefixed vault id', async () => {
    const { service, getTokens } = makeMutableService()

    // This is the legacy token shape written by the old CLI `tokens --add` path.
    await service.addToken(Chain.Ethereum, addedToken)
    expect(getTokens(Chain.Ethereum)[0]).toMatchObject({
      id: `${Chain.Ethereum}-${USDC}`,
      contractAddress: USDC,
    })

    vi.mocked(getEvmChainBalances).mockImplementation(async ({ chain, address, coins }) => {
      const requestedToken = coins.find(coin => coin.id !== undefined)
      // Mirror viem's rejection of the old `Ethereum-0x...` RPC id. If the
      // service regresses, getBalances() catches this chain-level failure and
      // silently returns no Ethereum entries.
      if (requestedToken?.id !== USDC) throw new Error(`invalid address: ${requestedToken?.id}`)

      return {
        [accountCoinKeyToString({ chain, address })]: 1_000_000_000_000_000_000n,
        [accountCoinKeyToString({ chain, id: USDC, address })]: 5_000_000n,
      }
    })

    const result = await service.getBalances({ chains: Chain.Ethereum, includeTokens: true })

    expect(result[Chain.Ethereum]?.formattedAmount).toBe('1')
    expect(result[`${Chain.Ethereum}:${USDC}`]?.formattedAmount).toBe('5')
    expect(result[`${Chain.Ethereum}:${USDC}`]?.tokenId).toBe(USDC)
    expect(getEvmChainBalances).toHaveBeenCalledWith(
      expect.objectContaining({
        coins: expect.arrayContaining([expect.objectContaining({ id: USDC })]),
      })
    )
  })

  it('does not duplicate a legacy-stored contract when it is re-added with its canonical id', async () => {
    const { service, getTokens, saveVault } = makeMutableService([addedToken])

    await service.addToken(Chain.Ethereum, { ...addedToken, id: USDC })

    expect(getTokens(Chain.Ethereum)).toEqual([addedToken])
    expect(saveVault).not.toHaveBeenCalled()
  })

  it('does not duplicate a lowercase-stored EVM contract when it is re-added with checksum casing', async () => {
    const checksummedUsdc = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
    const storedToken: Token = { ...addedToken, id: USDC, contractAddress: USDC }
    const { service, getTokens, saveVault } = makeMutableService([storedToken])

    await service.addToken(Chain.Ethereum, {
      ...storedToken,
      id: checksummedUsdc,
      contractAddress: checksummedUsdc,
    })

    expect(getTokens(Chain.Ethereum)).toEqual([storedToken])
    expect(saveVault).not.toHaveBeenCalled()
  })

  it('uses the token asset id for the non-EVM per-coin balance path', async () => {
    const mint = 'So11111111111111111111111111111111111111112'
    const secondMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    const solanaToken: Token = {
      id: `${Chain.Solana}-${mint}`,
      contractAddress: mint,
      symbol: 'WSOL',
      name: 'Wrapped SOL',
      decimals: 9,
      chainId: Chain.Solana,
      isNative: false,
    }
    const collidingToken: Token = {
      id: 'wsol',
      contractAddress: secondMint,
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      chainId: Chain.Solana,
      isNative: false,
    }
    let allTokens: Record<string, Token[]> = { [Chain.Solana]: [solanaToken, collidingToken] }
    const service = new BalanceService(
      cacheService,
      vi.fn(),
      vi.fn(),
      async chain => `${chain}-address`,
      chain => allTokens[chain] ?? [],
      () => allTokens,
      tokens => {
        allTokens = tokens
      },
      vi.fn(),
      vi.fn(),
      vi.fn()
    )
    vi.mocked(getCoinBalance).mockImplementation(async ({ id }) => {
      if (id === solanaToken.id || id === collidingToken.id) throw new Error(`invalid asset id: ${id}`)
      if (id === secondMint) return 7_000_000n
      return id === mint ? 5_000_000_000n : 1_000_000_000n
    })

    const result = await service.getBalances({ chains: Chain.Solana, includeTokens: true })

    // `collidingToken.id` equals the first token's symbol. Resolving that id
    // against the whole list would fetch WSOL twice and label one as USDC.
    expect(vi.mocked(getCoinBalance).mock.calls.map(([input]) => input.id)).toEqual([undefined, mint, secondMint])
    expect(result[Chain.Solana]).toBeDefined()
    expect(result[`${Chain.Solana}:${mint}`]?.formattedAmount).toBe('5')
    expect(result[`${Chain.Solana}:${mint}`]?.tokenId).toBe(mint)
    expect(result[`${Chain.Solana}:${collidingToken.id}`]?.formattedAmount).toBe('7')
  })

  it('removes an added token by symbol through the shared token resolver', async () => {
    const { service, getTokens, saveVault, emitTokenRemoved } = makeMutableService([addedToken])

    await expect(service.removeToken(Chain.Ethereum, 'USDC')).resolves.toBe(true)

    expect(getTokens(Chain.Ethereum)).toEqual([])
    expect(saveVault).toHaveBeenCalledTimes(1)
    expect(emitTokenRemoved).toHaveBeenCalledWith({ chain: Chain.Ethereum, tokenId: addedToken.id })
  })

  it('removes an added token by contract address through the shared token resolver', async () => {
    const { service, getTokens } = makeMutableService([addedToken])

    await expect(service.removeToken(Chain.Ethereum, USDC.toUpperCase())).resolves.toBe(true)

    expect(getTokens(Chain.Ethereum)).toEqual([])
  })

  it('removes the exact case-sensitive Solana mint when a case-variant sibling is tracked', async () => {
    const upperMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    const lowerMint = 'ePjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    const upperToken: Token = {
      id: upperMint,
      contractAddress: upperMint,
      symbol: 'USDC_A',
      name: 'USD Coin A',
      decimals: 6,
      chainId: Chain.Solana,
    }
    const lowerToken: Token = {
      ...upperToken,
      id: lowerMint,
      contractAddress: lowerMint,
      symbol: 'USDC_B',
      name: 'USD Coin B',
    }
    let allTokens: Record<string, Token[]> = { [Chain.Solana]: [upperToken, lowerToken] }
    const service = new BalanceService(
      cacheService,
      vi.fn(),
      vi.fn(),
      async chain => `${chain}-address`,
      chain => allTokens[chain] ?? [],
      () => allTokens,
      tokens => {
        allTokens = tokens
      },
      vi.fn(),
      vi.fn(),
      vi.fn()
    )

    await expect(service.removeToken(Chain.Solana, lowerMint)).resolves.toBe(true)

    expect(allTokens[Chain.Solana]).toEqual([upperToken])
  })

  it('reports that no token was removed when the reference does not exist', async () => {
    const { service, getTokens, saveVault, emitTokenRemoved } = makeMutableService([addedToken])

    await expect(service.removeToken(Chain.Ethereum, 'NOT-TRACKED')).resolves.toBe(false)

    expect(getTokens(Chain.Ethereum)).toEqual([addedToken])
    expect(saveVault).not.toHaveBeenCalled()
    expect(emitTokenRemoved).not.toHaveBeenCalled()
  })

  it('rolls the token back and does not emit removal when persisting fails', async () => {
    const { service, getTokens, saveVault, emitTokenRemoved } = makeMutableService([addedToken])
    saveVault.mockRejectedValueOnce(new Error('disk full'))

    // The removal is optimistic: state is mutated before saveVault(). A failed
    // save must restore the pre-removal token list rather than leave the vault
    // in memory disagreeing with the vault on disk.
    await expect(service.removeToken(Chain.Ethereum, 'USDC')).rejects.toThrow('disk full')

    expect(getTokens(Chain.Ethereum)).toEqual([addedToken])
    expect(emitTokenRemoved).not.toHaveBeenCalled()
  })

  it('removes a token stored with an empty contractAddress', async () => {
    // Token discovery writes `contractAddress: coin.id ?? ''`, so a stored token
    // can carry an empty contractAddress and be identified by its id alone. The
    // resolver falls back to `id` here, and the removal match must use the same
    // `||` fallback — matching on `??` would compare against '' and leave the
    // token permanently unremovable.
    const emptyContractToken: Token = { ...addedToken, id: USDC, contractAddress: '' }
    const { service, getTokens } = makeMutableService([emptyContractToken])

    await expect(service.removeToken(Chain.Ethereum, USDC)).resolves.toBe(true)

    expect(getTokens(Chain.Ethereum)).toEqual([])
  })

  it('removes a malformed token whose stored id is empty', async () => {
    const emptyIdToken: Token = {
      ...addedToken,
      id: '',
      contractAddress: undefined,
      symbol: 'GHOST',
    }
    const { service, getTokens, saveVault, emitTokenRemoved } = makeMutableService([emptyIdToken])

    await expect(service.removeToken(Chain.Ethereum, '')).resolves.toBe(true)

    expect(getTokens(Chain.Ethereum)).toEqual([])
    expect(saveVault).toHaveBeenCalledTimes(1)
    expect(emitTokenRemoved).toHaveBeenCalledWith({ chain: Chain.Ethereum, tokenId: '' })
  })

  it('refuses to remove the chain native asset and leaves tracked tokens alone', async () => {
    const { service, getTokens, saveVault } = makeMutableService([addedToken])

    await expect(service.removeToken(Chain.Ethereum, 'ETH')).resolves.toBe(false)

    expect(getTokens(Chain.Ethereum)).toEqual([addedToken])
    expect(saveVault).not.toHaveBeenCalled()
  })

  it('removes the exact stored id when a discovered and a CLI-added copy coexist', async () => {
    // addToken dedupes on exact id, so a vault can hold both shapes for one
    // asset. Naming one exactly must remove that record, not its sibling.
    const discoveredCopy: Token = { ...addedToken, id: USDC, contractAddress: USDC }
    const { service, getTokens, emitTokenRemoved } = makeMutableService([discoveredCopy, addedToken])

    await expect(service.removeToken(Chain.Ethereum, addedToken.id)).resolves.toBe(true)

    expect(getTokens(Chain.Ethereum)).toEqual([discoveredCopy])
    expect(emitTokenRemoved).toHaveBeenCalledWith({ chain: Chain.Ethereum, tokenId: addedToken.id })
  })

  it('refuses an ambiguous symbol when two tracked contracts share it', async () => {
    // A vault following the users guide stores USDT with `id: 'usdt'`. If it
    // also tracks a bridged USDT, the ref 'USDT' is both an exact id of one
    // record and the symbol of another. Removal must agree with the resolver —
    // otherwise `--remove USDT` deletes a different asset than the one
    // `send({ symbol: 'USDT' })` would spend.
    const bridged: Token = {
      id: '0x00000000000000000000000000000000000br1dge',
      contractAddress: '0x00000000000000000000000000000000000br1dge',
      symbol: 'USDT',
      name: 'Bridged Tether',
      decimals: 6,
      chainId: Chain.Ethereum,
      isNative: false,
    }
    const canonical: Token = {
      id: 'usdt',
      contractAddress: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      symbol: 'USDT',
      name: 'Tether USD',
      decimals: 6,
      chainId: Chain.Ethereum,
      isNative: false,
    }
    const { service, getTokens } = makeMutableService([bridged, canonical])

    await expect(service.removeToken(Chain.Ethereum, 'USDT')).resolves.toBe(false)

    expect(getTokens(Chain.Ethereum)).toEqual([bridged, canonical])
  })

  it('removes the record carrying the named symbol when one asset is tracked twice', async () => {
    // Discovery stores the contract under its on-chain symbol; `tokens --add
    // --symbol USDCoin` can store a second record for the SAME contract under a
    // different symbol. Removing by one symbol must delete that record, not its
    // sibling — otherwise the CLI reports removing USDCoin while USDCoin stays
    // listed and USDC silently disappears.
    const discovered: Token = { ...addedToken, id: USDC, contractAddress: USDC, symbol: 'USDC' }
    const renamed: Token = { ...addedToken, symbol: 'USDCoin' }
    const { service, getTokens } = makeMutableService([discovered, renamed])

    await expect(service.removeToken(Chain.Ethereum, 'USDCoin')).resolves.toBe(true)

    expect(getTokens(Chain.Ethereum)).toEqual([discovered])
  })

  it('removes the symbol-matched record even when another record uses the ticker as its id', async () => {
    // A ticker-keyed id ('usdc') on one record and the symbol 'USDC' on another
    // make the reference 'USDC' match different records depending on which
    // question you ask. The resolver answers symbol-first, so removal must too:
    // otherwise `--remove USDC` reports success while USDC stays tracked and
    // the differently-named sibling silently disappears.
    const bySymbol: Token = { ...addedToken, id: USDC, contractAddress: USDC, symbol: 'USDC' }
    const byTickerId: Token = { ...addedToken, id: 'usdc', contractAddress: USDC, symbol: 'USDCoin' }
    const { service, getTokens } = makeMutableService([bySymbol, byTickerId])

    await expect(service.removeToken(Chain.Ethereum, 'USDC')).resolves.toBe(true)

    expect(getTokens(Chain.Ethereum)).toEqual([byTickerId])
  })

  it('removes the exact legacy-prefixed id before symbol fallback can reinterpret it', async () => {
    // Legacy EVM records were historically stored as `<Chain>-<address>`, but the
    // prefix stripper is broad enough to rewrite any `<Chain>-...` id. If removal
    // canonicalizes that raw id BEFORE deciding whether the ref is a symbol or an
    // exact record id, `Ethereum-USDC` collapses to `usdc` and can delete a
    // different sibling whose symbol is `USDC`.
    const literalLegacyId: Token = {
      ...addedToken,
      id: 'Ethereum-USDC',
      contractAddress: undefined,
      symbol: 'Ethereum-USDC',
    }
    const bySymbol: Token = { ...addedToken, id: USDC, contractAddress: USDC, symbol: 'USDC' }
    const { service, getTokens } = makeMutableService([literalLegacyId, bySymbol])

    await expect(service.removeToken(Chain.Ethereum, 'Ethereum-USDC')).resolves.toBe(true)

    expect(getTokens(Chain.Ethereum)).toEqual([bySymbol])
  })

  it('removes only the referenced token when a chain tracks several', async () => {
    const DAI = '0x6b175474e89094c44da98b954eedeac495271d0f'
    const daiToken: Token = {
      id: `${Chain.Ethereum}-${DAI}`,
      contractAddress: DAI,
      symbol: 'DAI',
      name: 'Dai Stablecoin',
      decimals: 18,
      chainId: Chain.Ethereum,
      isNative: false,
    }
    const { service, getTokens } = makeMutableService([addedToken, daiToken])

    await expect(service.removeToken(Chain.Ethereum, 'USDC')).resolves.toBe(true)

    expect(getTokens(Chain.Ethereum)).toEqual([daiToken])
  })

  it("uses each selected record's asset id when a stored id collides with a sibling symbol", async () => {
    const DAI = '0x6b175474e89094c44da98b954eedeac495271d0f'
    const daiToken: Token = {
      // This storage id collides case-insensitively with addedToken.symbol.
      // Re-resolving it against both records would select USDC first.
      id: 'usdc',
      contractAddress: DAI,
      symbol: 'DAI',
      name: 'Dai Stablecoin',
      decimals: 18,
      chainId: Chain.Ethereum,
      isNative: false,
    }
    let allTokens: Record<string, Token[]> = { [Chain.Ethereum]: [addedToken, daiToken] }
    const service = new BalanceService(
      cacheService,
      vi.fn(),
      vi.fn(),
      async chain => `${chain}-address`,
      chain => allTokens[chain] ?? [],
      () => allTokens,
      tokens => {
        allTokens = tokens
      },
      vi.fn(),
      vi.fn(),
      vi.fn()
    )

    vi.mocked(getEvmChainBalances).mockImplementation(async ({ chain, address, coins }) => {
      const ids = coins.map(coin => coin.id).filter((id): id is string => id !== undefined)
      // Every tracked token must reach the RPC as its own contract address —
      // one token resolving to the wrong id would silently mislabel the other.
      if (ids.some(id => id !== USDC && id !== DAI)) throw new Error(`invalid address: ${ids.join(',')}`)

      return {
        [accountCoinKeyToString({ chain, address })]: 1_000_000_000_000_000_000n,
        [accountCoinKeyToString({ chain, id: USDC, address })]: 5_000_000n,
        [accountCoinKeyToString({ chain, id: DAI, address })]: 7_000_000_000_000_000_000n,
      }
    })

    const result = await service.getBalances({ chains: Chain.Ethereum, includeTokens: true })

    expect(result[Chain.Ethereum]?.formattedAmount).toBe('1')
    expect(result[`${Chain.Ethereum}:${USDC}`]?.formattedAmount).toBe('5')
    expect(result[`${Chain.Ethereum}:${daiToken.id}`]?.formattedAmount).toBe('7')
  })

  it('renders a legacy prefixed token id once, using its bare contract address', async () => {
    const address = `${Chain.Ethereum}-address`
    const service = makeReadService([addedToken])
    vi.mocked(getEvmChainBalances).mockResolvedValue({
      [accountCoinKeyToString({ chain: Chain.Ethereum, address })]: 1_000_000_000_000_000_000n,
      [accountCoinKeyToString({ chain: Chain.Ethereum, id: USDC, address })]: 5_000_000n,
    })

    const result = await service.getBalances({ chains: Chain.Ethereum, includeTokens: true })

    expect(result).toHaveProperty(`${Chain.Ethereum}:${USDC}`)
    expect(result).not.toHaveProperty(`${Chain.Ethereum}:${addedToken.id}`)
    expect(result[`${Chain.Ethereum}:${USDC}`]?.tokenId).toBe(USDC)
  })

  it('batches native + token balances for an EVM chain into a single multicall', async () => {
    const ethAddress = `${Chain.Ethereum}-address`
    vi.mocked(getEvmChainBalances).mockResolvedValue({
      [accountCoinKeyToString({ chain: Chain.Ethereum, address: ethAddress })]: 1_000_000_000_000_000_000n,
      [accountCoinKeyToString({ chain: Chain.Ethereum, id: token.id, address: ethAddress })]: 5_000_000n,
    })
    vi.mocked(getCoinBalance).mockResolvedValue(100_000_000n)

    const service = makeService()

    const result = await service.getBalances({
      chains: [Chain.Ethereum, Chain.Bitcoin],
      includeTokens: true,
    })

    // ONE multicall for the whole EVM chain (native + token), not one RPC per coin.
    expect(getEvmChainBalances).toHaveBeenCalledTimes(1)
    expect(vi.mocked(getEvmChainBalances).mock.calls[0][0]).toEqual({
      chain: Chain.Ethereum,
      address: ethAddress,
      coins: [
        { chain: Chain.Ethereum, address: ethAddress },
        { chain: Chain.Ethereum, id: token.id, address: ethAddress },
      ],
    })

    // Non-EVM chain (Bitcoin) still uses the per-coin path — native only.
    expect(getCoinBalance).toHaveBeenCalledTimes(1)
    expect(vi.mocked(getCoinBalance).mock.calls.map(([input]) => [input.chain, input.id])).toEqual([
      [Chain.Bitcoin, undefined],
    ])

    expect(result[Chain.Ethereum]?.formattedAmount).toBe('1')
    expect(result[`${Chain.Ethereum}:${token.id}`]?.formattedAmount).toBe('5')
    expect(result[Chain.Bitcoin]?.formattedAmount).toBe('1')
  })

  it('uses one lowercase EVM identity for result, balance, RPC, cache, and invalidation keys', async () => {
    const checksummedUsdc = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
    const checksummedToken: Token = { ...token, id: checksummedUsdc }
    const ethAddress = `${Chain.Ethereum}-address`
    const setScoped = vi.spyOn(cacheService, 'setScoped')
    const invalidateScoped = vi.spyOn(cacheService, 'invalidateScoped')
    vi.mocked(getEvmChainBalances).mockResolvedValue({
      [accountCoinKeyToString({ chain: Chain.Ethereum, address: ethAddress })]: 1_000_000_000_000_000_000n,
      [accountCoinKeyToString({ chain: Chain.Ethereum, id: USDC, address: ethAddress })]: 5_000_000n,
    })
    vi.mocked(getCoinBalance).mockResolvedValue(5_000_000n)
    const service = makeReadService([checksummedToken])

    const result = await service.getBalances({ chains: Chain.Ethereum, includeTokens: true })

    expect(result[`${Chain.Ethereum}:${USDC}`]?.tokenId).toBe(USDC)
    expect(result[`${Chain.Ethereum}:${checksummedUsdc}`]).toBeUndefined()
    expect(getEvmChainBalances).toHaveBeenCalledWith(
      expect.objectContaining({ coins: expect.arrayContaining([expect.objectContaining({ id: USDC })]) })
    )
    expect(setScoped).toHaveBeenCalledWith(`ethereum:${USDC}`, CacheScope.BALANCE, expect.any(Object))

    const refreshed = await service.updateBalance(Chain.Ethereum, checksummedUsdc)

    expect(invalidateScoped).toHaveBeenCalledWith(`ethereum:${USDC}`, CacheScope.BALANCE)
    expect(getCoinBalance).toHaveBeenCalledWith(expect.objectContaining({ id: USDC }))
    expect(refreshed.tokenId).toBe(USDC)
  })

  it('does NOT cache or emit a coin the multicall omitted, and refetches it next call (#1191)', async () => {
    const ethAddress = `${Chain.Ethereum}-address`
    const nativeKey = accountCoinKeyToString({ chain: Chain.Ethereum, address: ethAddress })
    const tokenKey = accountCoinKeyToString({ chain: Chain.Ethereum, id: token.id, address: ethAddress })
    // Multicall returns native but OMITS the token (a transient partial-aggregate / RPC hiccup).
    vi.mocked(getEvmChainBalances).mockResolvedValue({
      [nativeKey]: 1_000_000_000_000_000_000n,
    })

    const emitBalanceUpdated = vi.fn()
    const service = new BalanceService(
      cacheService,
      emitBalanceUpdated,
      vi.fn(),
      async chain => `${chain}-address`,
      chain => (chain === Chain.Ethereum ? [token] : []),
      () => ({ [Chain.Ethereum]: [token] }),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn()
    )

    const first = await service.getBalances({ chains: [Chain.Ethereum], includeTokens: true })
    await flushMicrotasks()

    // Native (present) is returned; the omitted token is returned transiently for shape completeness...
    expect(first[Chain.Ethereum]?.formattedAmount).toBe('1')
    // ...but the omitted token is NEVER emitted as a real balance (only the present native fired).
    const emittedTokenIds = emitBalanceUpdated.mock.calls.map(([d]) => d.tokenId)
    expect(emittedTokenIds).toContain(undefined) // native
    expect(emittedTokenIds).not.toContain(token.id) // omitted token must not emit a phantom 0

    // The omitted token was NOT cached — a second call re-multicalls (native is cache-served, token refetches).
    vi.mocked(getEvmChainBalances).mockResolvedValue({
      [nativeKey]: 1_000_000_000_000_000_000n,
      [tokenKey]: 5_000_000n,
    })
    const second = await service.getBalances({ chains: [Chain.Ethereum], includeTokens: true })

    expect(getEvmChainBalances).toHaveBeenCalledTimes(2) // refetched because the token was never cached
    expect(second[`${Chain.Ethereum}:${token.id}`]?.formattedAmount).toBe('5') // real value on refetch
  })

  it('serves cached EVM balances without re-multicalling', async () => {
    const ethAddress = `${Chain.Ethereum}-address`
    vi.mocked(getEvmChainBalances).mockResolvedValue({
      [accountCoinKeyToString({ chain: Chain.Ethereum, address: ethAddress })]: 1_000_000_000_000_000_000n,
      [accountCoinKeyToString({ chain: Chain.Ethereum, id: token.id, address: ethAddress })]: 5_000_000n,
    })

    const service = makeService()

    // First call warms the balance cache for native + token.
    await service.getBalances({ chains: [Chain.Ethereum], includeTokens: true })
    await flushMicrotasks()

    // Second identical call is fully cache-served — no additional multicall.
    const cached = await service.getBalances({ chains: [Chain.Ethereum], includeTokens: true })

    expect(getEvmChainBalances).toHaveBeenCalledTimes(1)
    expect(cached[Chain.Ethereum]?.formattedAmount).toBe('1')
    expect(cached[`${Chain.Ethereum}:${token.id}`]?.formattedAmount).toBe('5')
  })

  describe('addToken / removeToken - Ripple issued-currency id normalization', () => {
    const issuer = 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De'
    // The on-ledger id ledger discovery stores (RLUSD encoded as its 40-hex code).
    const canonicalId = rippleTokenId({ currency: 'RLUSD', issuer })
    // The same token entered by its human ticker, as shown on explorers.
    const humanTickerId = `RLUSD.${issuer}`

    const rippleToken = (id: string): Token => ({
      id,
      symbol: 'RLUSD',
      name: 'Ripple USD',
      decimals: 15,
      contractAddress: id,
      chainId: Chain.Ripple,
    })

    const makeStatefulService = (initial: Record<string, Token[]> = {}, saveVault = vi.fn()) => {
      let store: Record<string, Token[]> = initial
      const emitTokenAdded = vi.fn()
      const service = new BalanceService(
        cacheService,
        vi.fn(),
        vi.fn(),
        async chain => `${chain}-address`,
        chain => store[chain] ?? [],
        () => store,
        tokens => {
          store = tokens
        },
        saveVault,
        emitTokenAdded,
        vi.fn()
      )
      return { service, emitTokenAdded, ripple: () => store[Chain.Ripple] ?? [] }
    }

    it('collapses a manual human-ticker add and an auto-discovered canonical id into one token', async () => {
      // Discovery already stored the on-ledger canonical id.
      const { service, ripple } = makeStatefulService({ [Chain.Ripple]: [rippleToken(canonicalId)] })

      // User manually adds the same token by its human ticker.
      await service.addToken(Chain.Ripple, rippleToken(humanTickerId))

      expect(ripple()).toHaveLength(1)
      expect(ripple()[0].id).toBe(canonicalId)
    })

    it('persists a manually added human-ticker token under its canonical id', async () => {
      const { service, ripple } = makeStatefulService()

      await service.addToken(Chain.Ripple, rippleToken(humanTickerId))

      expect(ripple()).toHaveLength(1)
      expect(ripple()[0].id).toBe(canonicalId)
      expect(ripple()[0].contractAddress).toBe(canonicalId)
    })

    it('removes a canonical-stored token when asked by its human-ticker id', async () => {
      const { service, ripple } = makeStatefulService({ [Chain.Ripple]: [rippleToken(canonicalId)] })

      await service.removeToken(Chain.Ripple, humanTickerId)

      expect(ripple()).toHaveLength(0)
    })

    it('rolls the add back when persistence fails, leaving no phantom token', async () => {
      const saveVault = vi.fn().mockRejectedValue(new Error('disk full'))
      const { service, emitTokenAdded, ripple } = makeStatefulService({ [Chain.Ripple]: [] }, saveVault)

      await expect(service.addToken(Chain.Ripple, rippleToken(humanTickerId))).rejects.toThrow('disk full')

      // The caller was told the add failed, so it must not linger in memory and
      // get persisted by some later successful save.
      expect(ripple()).toHaveLength(0)
      expect(emitTokenAdded).not.toHaveBeenCalled()
    })

    it('does not corrupt live vault state when persistence fails', async () => {
      const existing = rippleToken(canonicalId)
      // getAllTokens() hands back live state; a failed add must leave it untouched.
      const live: Record<string, Token[]> = { [Chain.Ripple]: [existing] }
      const saveVault = vi.fn().mockRejectedValue(new Error('disk full'))
      const { service, ripple } = makeStatefulService(live, saveVault)

      await expect(service.addToken(Chain.Ripple, rippleToken(`USD.${issuer}`))).rejects.toThrow('disk full')

      // The caller's original record is never mutated in place...
      expect(live[Chain.Ripple]).toEqual([existing])
      // ...and the store the service actually reads from is rolled back to it,
      // so no stale optimistic token survives the failed save.
      expect(ripple()).toEqual([existing])
    })
  })
})
