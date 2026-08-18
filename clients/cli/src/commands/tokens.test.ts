import type { Chain as ChainType, DiscoveredToken, Token, VaultBase } from '@vultisig/sdk'
import { Chain } from '@vultisig/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CommandContext } from '../core'
import { ExitCode, TokenNotFoundError } from '../core/errors'
import { configureOutput, resetOutput } from '../lib/output'
import { addToken, discoverTokens, removeToken } from './tokens'

const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
const HEX = '0x2b591e99afe9f32eaa6214f7b7629768c40eeb39'

function makeCtx(discovered: DiscoveredToken[], existing: Token[] = []) {
  const stored = [...existing]
  const addToken = vi.fn(async (_chain: ChainType, token: Token) => {
    stored.push(token)
  })
  const vault = {
    discoverTokens: vi.fn(async () => discovered),
    getTokens: vi.fn(() => stored),
    addToken,
  } as unknown as VaultBase
  return { ctx: { ensureActiveVault: async () => vault } as unknown as CommandContext, addToken, stored }
}

function discoveredToken(contractAddress: string, ticker: string, decimals: number): DiscoveredToken {
  return { contractAddress, ticker, decimals } as DiscoveredToken
}

describe('tokens --add', () => {
  afterEach(() => {
    resetOutput()
    vi.restoreAllMocks()
  })

  it('stores the same bare lowercase id through manual add and discovery', async () => {
    configureOutput({ format: 'json' })
    const checksummed = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
    const addTokenToVault = vi.fn(async (_chain: ChainType, _token: Token) => {})
    const manualVault = { addToken: addTokenToVault } as unknown as VaultBase
    const manualCtx = { ensureActiveVault: async () => manualVault } as unknown as CommandContext

    await addToken(manualCtx, {
      chain: Chain.Ethereum,
      contractAddress: checksummed,
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
    })
    const { ctx: discoveryCtx, addToken: addDiscoveredToken } = makeCtx([discoveredToken(checksummed, 'USDC', 6)])
    await discoverTokens(discoveryCtx, Chain.Ethereum)

    const manual = addTokenToVault.mock.calls[0][1]
    const discovered = addDiscoveredToken.mock.calls[0][1]
    expect(manual).toMatchObject({ id: USDC, contractAddress: USDC })
    expect(discovered).toMatchObject({ id: USDC, contractAddress: USDC })
    expect(manual.id).toBe(discovered.id)
  })
})

describe('tokens --remove', () => {
  afterEach(() => {
    resetOutput()
    vi.restoreAllMocks()
  })

  it.each(['USDC', USDC])('prints success only after the SDK removes %s', async tokenRef => {
    configureOutput({ format: 'table', silent: false })
    const removeTokenFromVault = vi.fn(async () => true)
    const vault = { removeToken: removeTokenFromVault } as unknown as VaultBase
    const ctx = { ensureActiveVault: async () => vault } as unknown as CommandContext
    const logs: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '))
    })

    await removeToken(ctx, Chain.Ethereum, tokenRef)

    expect(removeTokenFromVault).toHaveBeenCalledWith(Chain.Ethereum, tokenRef)
    expect(logs.join('\n')).toMatch(/Removed token/)
  })

  it('throws resource-not-found and never prints success when nothing matched', async () => {
    configureOutput({ format: 'table', silent: false })
    const removeTokenFromVault = vi.fn(async () => false)
    const vault = { removeToken: removeTokenFromVault } as unknown as VaultBase
    const ctx = { ensureActiveVault: async () => vault } as unknown as CommandContext
    const logs: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '))
    })

    const error = await removeToken(ctx, Chain.Ethereum, 'NOT-TRACKED').catch(err => err)

    expect(error).toBeInstanceOf(TokenNotFoundError)
    expect((error as TokenNotFoundError).exitCode).toBe(ExitCode.RESOURCE_NOT_FOUND)
    expect(logs.join('\n')).not.toMatch(/Removed token/)
  })

  it('emits the v1 success envelope in JSON mode', async () => {
    configureOutput({ format: 'json' })
    const vault = { removeToken: vi.fn(async () => true) } as unknown as VaultBase
    const ctx = { ensureActiveVault: async () => vault } as unknown as CommandContext
    const writes: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      writes.push(String(chunk))
      return true
    })

    await removeToken(ctx, Chain.Ethereum, USDC)

    expect(JSON.parse(writes.join(''))).toEqual({
      success: true,
      v: 1,
      data: { chain: Chain.Ethereum, tokenId: USDC, removed: true },
    })
  })
})

describe('tokens --discover', () => {
  afterEach(() => {
    resetOutput()
    vi.restoreAllMocks()
  })

  describe('persistence (intended behaviour — pinned so a future change is a deliberate one)', () => {
    beforeEach(() => configureOutput({ format: 'json' }))

    it('saves every newly discovered token to the vault', async () => {
      const { ctx, addToken } = makeCtx([discoveredToken(USDC, 'USDC', 6), discoveredToken(HEX, 'HEX', 8)])

      await discoverTokens(ctx, Chain.Ethereum)

      expect(addToken).toHaveBeenCalledTimes(2)
      expect(addToken).toHaveBeenCalledWith(
        Chain.Ethereum,
        expect.objectContaining({ id: USDC, symbol: 'USDC', decimals: 6, contractAddress: USDC })
      )
    })

    it('does not re-add a token the vault already tracks', async () => {
      const existing: Token = {
        id: USDC,
        symbol: 'USDC',
        name: 'USDC',
        decimals: 6,
        contractAddress: USDC,
        chainId: Chain.Ethereum,
        isNative: false,
      }
      const { ctx, addToken } = makeCtx([discoveredToken(USDC, 'USDC', 6), discoveredToken(HEX, 'HEX', 8)], [existing])

      await discoverTokens(ctx, Chain.Ethereum)

      expect(addToken).toHaveBeenCalledTimes(1)
      expect(addToken).toHaveBeenCalledWith(Chain.Ethereum, expect.objectContaining({ id: HEX }))
    })
  })

  describe('disclosure', () => {
    it('tells the user the discovered tokens were saved and what that affects', async () => {
      configureOutput({ format: 'table', silent: false })
      const logs: string[] = []
      vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(' '))
      })

      const { ctx } = makeCtx([discoveredToken(USDC, 'USDC', 6)])
      await discoverTokens(ctx, Chain.Ethereum)

      const joined = logs.join('\n')
      expect(joined).toMatch(/saved to this vault/i)
      expect(joined).toMatch(/portfolio/i)
      expect(joined).toMatch(/--remove/)
    })

    it('says it is now tracking the tokens rather than merely reporting them', async () => {
      configureOutput({ format: 'table', silent: false })
      const succeed = vi.fn()
      vi.spyOn(await import('../lib/output'), 'createSpinner').mockReturnValue({
        succeed,
        fail: vi.fn(),
        stop: vi.fn(),
        text: '',
      } as never)

      const { ctx } = makeCtx([discoveredToken(USDC, 'USDC', 6)])
      await discoverTokens(ctx, Chain.Ethereum)

      expect(succeed).toHaveBeenCalledWith(expect.stringMatching(/now tracking 1 new token/i))
    })
  })
})
