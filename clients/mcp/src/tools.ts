import * as z from 'zod/v4'

import type { Vault } from './types.js'

type ToolResult = {
  [key: string]: unknown
  content: [{ type: 'text'; text: string }]
  isError?: boolean
}

function success(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] }
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

function resolveChain(name: string, knownChains: readonly string[]): string {
  const match = knownChains.find(c => c.toLowerCase() === name.toLowerCase())
  if (!match) throw new Error(`Unknown chain "${name}". Use supported_chains or vault_info to see available chains.`)
  return match
}

function parseChainToken(input: string, knownChains: readonly string[]): { chain: string; symbol?: string } {
  const parts = input.split(':')
  const chain = resolveChain(parts[0], knownChains)
  return { chain, symbol: parts[1] }
}

export type ToolDef = {
  description: string
  inputSchema: z.ZodObject<z.ZodRawShape>
  handler: (args: Record<string, unknown>) => Promise<ToolResult>
}

export type Profile = 'harness' | 'defi' | 'full'

const READ_ONLY_TOOLS = ['get_balances', 'get_portfolio', 'get_address', 'vault_info', 'supported_chains', 'swap_quote']
const WRITE_TOOLS = ['send', 'swap']

export function getTools(vault: Vault, profile: Profile = 'defi'): Record<string, ToolDef> {
  const knownChains = vault.chains

  const all: Record<string, ToolDef> = {
    get_balances: {
      description: 'Get native token balances for all chains or a specific chain',
      inputSchema: z.object({
        chain: z.string().optional().describe('Filter by chain name (e.g. Ethereum, Bitcoin)'),
        includeTokens: z.boolean().optional().describe('Include ERC-20/SPL token balances'),
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
      description: 'Get balances with fiat (USD) valuations for all chains or a specific chain',
      inputSchema: z.object({
        chain: z.string().optional().describe('Filter by chain name'),
        includeTokens: z.boolean().optional().describe('Include ERC-20/SPL token balances'),
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
      description: 'Get the wallet address for a specific chain',
      inputSchema: z.object({
        chain: z.string().describe('Chain name (e.g. Ethereum, Bitcoin)'),
      }),
      handler: args =>
        wrapHandler(async () => {
          const chain = resolveChain(args.chain as string, knownChains)
          const address = await vault.address(chain)
          return { chain, address }
        }),
    },

    vault_info: {
      description: 'Get vault metadata including name, type, chains, and signer configuration',
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
      description: 'List chains supported for swaps',
      inputSchema: z.object({}),
      handler: () =>
        wrapHandler(async () => {
          const chains = vault.getSupportedSwapChains()
          return { chains }
        }),
    },

    swap_quote: {
      description: 'Get a swap quote showing estimated output and provider',
      inputSchema: z.object({
        from: z.string().describe('Source chain or chain:token (e.g. Ethereum or Ethereum:USDC)'),
        to: z.string().describe('Destination chain or chain:token'),
        amount: z.string().describe('Amount to swap'),
      }),
      handler: args =>
        wrapHandler(async () => {
          const from = parseChainToken(args.from as string, knownChains)
          const to = parseChainToken(args.to as string, knownChains)
          return vault.swap({
            fromChain: from.chain,
            fromSymbol: from.symbol ?? from.chain,
            toChain: to.chain,
            toSymbol: to.symbol ?? to.chain,
            amount: args.amount as string,
            dryRun: true,
          })
        }),
    },

    send: {
      description: 'Send tokens to an address. Set confirmed=false for a dry-run preview first.',
      inputSchema: z.object({
        chain: z.string().describe('Chain to send on (e.g. Ethereum)'),
        to: z.string().describe('Recipient address'),
        amount: z.string().describe('Amount to send (or "max")'),
        token: z.string().optional().describe('Token symbol (for ERC-20/SPL tokens)'),
        memo: z.string().optional().describe('Transaction memo (non-EVM chains only)'),
        confirmed: z.boolean().optional().describe('Set true to execute, false/omit for dry-run preview'),
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
            dryRun: !args.confirmed,
          })
        }),
    },

    swap: {
      description: 'Execute a token swap. Set confirmed=false for a dry-run preview first.',
      inputSchema: z.object({
        from: z.string().describe('Source chain or chain:token (e.g. Ethereum or Ethereum:USDC)'),
        to: z.string().describe('Destination chain or chain:token'),
        amount: z.string().describe('Amount to swap'),
        confirmed: z.boolean().optional().describe('Set true to execute, false/omit for dry-run preview'),
      }),
      handler: args =>
        wrapHandler(async () => {
          const from = parseChainToken(args.from as string, knownChains)
          const to = parseChainToken(args.to as string, knownChains)
          return vault.swap({
            fromChain: from.chain,
            fromSymbol: from.symbol ?? from.chain,
            toChain: to.chain,
            toSymbol: to.symbol ?? to.chain,
            amount: args.amount as string,
            dryRun: !args.confirmed,
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
