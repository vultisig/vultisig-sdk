import { descriptions } from '@vultisig/client-shared'
import * as z from 'zod/v4'

import type { Vault } from './types.js'

type ToolResult = {
  [key: string]: unknown
  content: [{ type: 'text'; text: string }]
  isError?: boolean
}

function success(data: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)) }],
  }
}

function error(message: string, hint?: string): ToolResult {
  const payload: Record<string, string> = { error: message }
  if (hint) payload.hint = hint
  return { content: [{ type: 'text', text: JSON.stringify(payload) }], isError: true }
}

async function wrapHandler<T>(fn: () => Promise<T>): Promise<ToolResult> {
  try {
    return success(await fn())
  } catch (err: unknown) {
    if (err instanceof Error) return error(err.message)
    return error(String(err))
  }
}

export function resolveChain(name: string, knownChains: readonly string[]): string {
  const match = knownChains.find(c => c.toLowerCase() === name.toLowerCase())
  if (!match) throw new Error(`Unknown chain "${name}". Use supported_chains or vault_info to see available chains.`)
  return match
}

export function parseChainToken(input: string, knownChains: readonly string[]): { chain: string; symbol?: string } {
  const parts = input.split(':')
  const chain = resolveChain(parts[0], knownChains)
  return { chain, symbol: parts[1] }
}

export type ToolDef = {
  description: string
  inputSchema: z.ZodObject<z.ZodRawShape>
  handler: (args: Record<string, unknown>) => Promise<ToolResult>
}

export type Profile = 'harness' | 'defi'

const READ_ONLY_TOOLS = ['get_balances', 'get_portfolio', 'get_address', 'vault_info', 'supported_chains', 'swap_quote']
const WRITE_TOOLS = ['send', 'swap']

export function getTools(vault: Vault, profile: Profile = 'defi'): Record<string, ToolDef> {
  const knownChains = vault.chains

  const all: Record<string, ToolDef> = {
    get_balances: {
      description: descriptions.balance.description,
      inputSchema: z.object({
        chain: z.string().optional().describe(descriptions.balance.params.chain),
        includeTokens: z.boolean().optional().describe(descriptions.balance.params.includeTokens),
      }),
      handler: args =>
        wrapHandler(async () => {
          const includeTokens = (args.includeTokens as boolean) ?? false
          const balances = await vault.allBalances(includeTokens)
          const chainFilter = args.chain as string | undefined
          if (!chainFilter) return balances
          const target = resolveChain(chainFilter, knownChains)
          return balances.filter(b => b.chain === target)
        }),
    },

    get_portfolio: {
      description: descriptions.portfolio.description,
      inputSchema: z.object({
        chain: z.string().optional().describe(descriptions.portfolio.params.chain),
      }),
      handler: args =>
        wrapHandler(async () => {
          const portfolio = await vault.portfolio()
          const chainFilter = args.chain as string | undefined
          if (!chainFilter) return portfolio
          const target = resolveChain(chainFilter, knownChains)
          return {
            ...portfolio,
            balances: portfolio.balances.filter(b => b.chain === target),
          }
        }),
    },

    get_address: {
      description: descriptions.address.description,
      inputSchema: z.object({
        chain: z.string().describe(descriptions.address.params.chain),
      }),
      handler: args =>
        wrapHandler(async () => {
          const chain = resolveChain(args.chain as string, knownChains)
          const address = await vault.address(chain)
          return { chain, address }
        }),
    },

    vault_info: {
      description: descriptions.vaultInfo.description,
      inputSchema: z.object({}),
      handler: () =>
        wrapHandler(async () => ({
          name: vault.name,
          type: vault.type,
          chains: vault.chains,
          signers: vault.signers,
          localPartyId: vault.localPartyId,
          threshold: vault.threshold,
          createdAt: vault.createdAt,
        })),
    },

    supported_chains: {
      description: descriptions.supportedChains.description,
      inputSchema: z.object({}),
      handler: () =>
        wrapHandler(async () => {
          const chains = vault.getSupportedSwapChains()
          return { chains }
        }),
    },

    swap_quote: {
      description: descriptions.swapQuote.description,
      inputSchema: z.object({
        from: z.string().describe(descriptions.swapQuote.params.from),
        to: z.string().describe(descriptions.swapQuote.params.to),
        amount: z.string().describe(descriptions.swapQuote.params.amount),
      }),
      handler: args =>
        wrapHandler(async () => {
          const from = parseChainToken(args.from as string, knownChains)
          const to = parseChainToken(args.to as string, knownChains)
          return vault.swap({
            fromChain: from.chain,
            fromSymbol: from.symbol,
            toChain: to.chain,
            toSymbol: to.symbol,
            amount: args.amount as string,
            dryRun: true,
          })
        }),
    },

    send: {
      description: descriptions.send.description,
      inputSchema: z.object({
        chain: z.string().describe(descriptions.send.params.chain),
        to: z.string().describe(descriptions.send.params.to),
        amount: z.string().describe(descriptions.send.params.amount),
        token: z.string().optional().describe(descriptions.send.params.token),
        memo: z.string().optional().describe(descriptions.send.params.memo),
        confirmed: z.boolean().optional().describe(descriptions.send.params.confirmed),
      }),
      handler: args =>
        wrapHandler(async () => {
          const chain = resolveChain(args.chain as string, knownChains)
          return vault.send({
            chain,
            to: args.to as string,
            amount: args.amount as string,
            symbol: args.token as string | undefined,
            memo: args.memo as string | undefined,
            dryRun: args.confirmed !== true,
          })
        }),
    },

    swap: {
      description: descriptions.swap.description,
      inputSchema: z.object({
        from: z.string().describe(descriptions.swap.params.from),
        to: z.string().describe(descriptions.swap.params.to),
        amount: z.string().describe(descriptions.swap.params.amount),
        confirmed: z.boolean().optional().describe(descriptions.swap.params.confirmed),
      }),
      handler: args =>
        wrapHandler(async () => {
          const from = parseChainToken(args.from as string, knownChains)
          const to = parseChainToken(args.to as string, knownChains)
          return vault.swap({
            fromChain: from.chain,
            fromSymbol: from.symbol,
            toChain: to.chain,
            toSymbol: to.symbol,
            amount: args.amount as string,
            dryRun: args.confirmed !== true,
          })
        }),
    },
  }

  if (profile === 'harness') {
    const filtered: Record<string, ToolDef> = {}
    for (const name of READ_ONLY_TOOLS) {
      if (all[name]) filtered[name] = all[name]
    }
    return filtered
  }

  return all
}

export function getToolNames(profile: Profile): string[] {
  if (profile === 'harness') return [...READ_ONLY_TOOLS]
  return [...READ_ONLY_TOOLS, ...WRITE_TOOLS]
}
