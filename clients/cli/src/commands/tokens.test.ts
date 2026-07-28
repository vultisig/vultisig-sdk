import type { Chain as ChainType, DiscoveredToken, Token, VaultBase } from '@vultisig/sdk'
import { Chain } from '@vultisig/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CommandContext } from '../core'
import { configureOutput, resetOutput } from '../lib/output'
import { discoverTokens } from './tokens'

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
      // The command has always written to the vault; the help and the output
      // described it as a lookup. A user who ran it expecting a query had no
      // way to know their vault file — and every later portfolio total — had
      // changed. Silence here is the defect, not the write itself.
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
      // The spinner's success line is the one-line summary a scripted user sees;
      // "Discovered N token(s)" read as a pure lookup.
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
