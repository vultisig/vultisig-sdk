/**
 * Token Commands - token management
 */
import type { Chain, DiscoveredToken } from '@vultisig/sdk'
import chalk from 'chalk'

import type { CommandContext } from '../core'
import { TokenNotFoundError } from '../core/errors'
import {
  createSpinner,
  info,
  isJsonOutput,
  outputJson,
  printResult,
  printTable,
  requireInteractive,
  success,
  warn,
} from '../lib/output'
import { prompt } from '../lib/prompt'

export type TokensOptions = {
  chain: Chain
  add?: string // contract address
  remove?: string // token ID
  discover?: boolean
  // Options for non-interactive token addition
  symbol?: string
  name?: string
  decimals?: number
}

export type AddTokenOptions = {
  chain: Chain
  contractAddress: string
  symbol: string
  name: string
  decimals: number
}

/**
 * Execute tokens command - list, add, or remove tokens
 */
export async function executeTokens(ctx: CommandContext, options: TokensOptions): Promise<void> {
  // Ensure vault is active before any operation
  await ctx.ensureActiveVault()

  if (options.discover) {
    await discoverTokens(ctx, options.chain)
    return
  }

  if (options.add) {
    // Use CLI options if provided, otherwise prompt
    let symbol = options.symbol
    let name = options.name
    let decimals = options.decimals

    // Only prompt for missing values
    const prompts = []
    if (!symbol) {
      prompts.push({
        type: 'input',
        name: 'symbol',
        message: 'Enter token symbol (e.g., USDT):',
        validate: (input: string) => input.trim() !== '' || 'Symbol is required',
      })
    }
    if (!name) {
      prompts.push({
        type: 'input',
        name: 'name',
        message: 'Enter token name (e.g., Tether USD):',
        validate: (input: string) => input.trim() !== '' || 'Name is required',
      })
    }
    if (decimals === undefined) {
      prompts.push({
        type: 'number',
        name: 'decimals',
        message: 'Enter token decimals:',
        default: 18,
        validate: (input: number) => input >= 0 || 'Decimals must be non-negative',
      })
    }

    if (prompts.length > 0) {
      requireInteractive('Provide --symbol, --name, and --decimals flags for non-interactive token addition.')
      const answers = await prompt(prompts)
      symbol = symbol || answers.symbol?.trim()
      name = name || answers.name?.trim()
      decimals = decimals ?? answers.decimals
    }

    await addToken(ctx, {
      chain: options.chain,
      contractAddress: options.add,
      symbol: symbol!,
      name: name!,
      decimals: decimals!,
    })
  } else if (options.remove) {
    await removeToken(ctx, options.chain, options.remove)
  } else {
    await listTokens(ctx, options.chain)
  }
}

/**
 * Add a token to a chain
 */
export async function addToken(ctx: CommandContext, options: AddTokenOptions): Promise<void> {
  const vault = await ctx.ensureActiveVault()

  // bead vultisig-sb7ub: tokenId must be the raw contract address to match how
  // discovery + storage key tokens across the SDK. Previously this used
  // `${chain}-${contractAddress}` which produced an id shape ('Ethereum-0x...')
  // that (a) rendered as a double-prefix 'Ethereum:Ethereum-0x...' in the
  // balances map, and (b) prevented removal — `vault.removeToken(chain, '0x...')`
  // normalises to the raw address and never matched the stored prefixed id, so
  // a manually-added token was orphaned in the vault with no CLI-side removal
  // path.
  await vault.addToken(options.chain, {
    id: options.contractAddress,
    contractAddress: options.contractAddress,
    symbol: options.symbol,
    name: options.name,
    decimals: options.decimals,
    chainId: options.chain,
    isNative: false,
  })

  success(`\n+ Added token ${options.symbol} on ${options.chain}`)
}

/**
 * Remove a token from a chain
 */
export async function removeToken(ctx: CommandContext, chain: Chain, tokenId: string): Promise<void> {
  const vault = await ctx.ensureActiveVault()

  const removed = await vault.removeToken(chain, tokenId)
  if (!removed) {
    throw new TokenNotFoundError(`Token "${tokenId}" not found on ${chain}`)
  }
  success(`\n+ Removed token ${tokenId} from ${chain}`)
}

/**
 * Discover tokens with balances on a chain and add them to the vault.
 *
 * The persistence is deliberate, not a side effect: `vault.discoverTokens()` is
 * the read-only half (it just returns what the address holds), and this command
 * is the "find what I hold and start tracking it" action, as distinct from
 * `--add <address>` for a token you can already name. That is why it reports
 * only tokens that are NEW relative to the stored list. What was wrong is that
 * nothing said so — the help called it "auto-discover", and a user who ran it
 * expecting a query found their vault file and later `portfolio` totals
 * changed. Both now state it.
 */
export async function discoverTokens(ctx: CommandContext, chain: Chain): Promise<void> {
  const vault = await ctx.ensureActiveVault()

  const spinner = createSpinner(`Discovering tokens on ${chain}...`)
  let discovered: DiscoveredToken[]
  try {
    discovered = await vault.discoverTokens(chain)
  } catch (err) {
    spinner.fail(`Token discovery failed for ${chain}`)
    throw err
  }

  if (discovered.length === 0) {
    spinner.succeed(`No new tokens found on ${chain}`)
    if (isJsonOutput()) {
      outputJson({ chain, discovered: [], count: 0 })
    }
    return
  }

  // Merge with existing tokens (no duplicates by contractAddress)
  const existingTokens = vault.getTokens(chain)
  const existingAddresses = new Set(existingTokens.map(t => t.contractAddress ?? t.id))

  const newTokens = discovered.filter(d => d.contractAddress && !existingAddresses.has(d.contractAddress))

  for (const d of newTokens) {
    await vault.addToken(chain, {
      id: d.contractAddress,
      symbol: d.ticker,
      name: d.ticker,
      decimals: d.decimals,
      contractAddress: d.contractAddress,
      chainId: chain,
      isNative: false,
    })
  }

  const allTokens = vault.getTokens(chain)

  spinner.succeed(`Now tracking ${newTokens.length} new token(s) on ${chain}`)

  if (isJsonOutput()) {
    outputJson({
      chain,
      discovered: newTokens.map(d => ({
        symbol: d.ticker,
        contractAddress: d.contractAddress,
        decimals: d.decimals,
      })),
      count: newTokens.length,
    })
    return
  }

  for (const d of newTokens) {
    printResult(`  ${d.ticker} (${d.contractAddress})`)
  }
  info(chalk.gray(`\nSaved to this vault — tracked tokens count toward portfolio and balance --tokens.`))
  info(chalk.gray(`Use --remove <tokenId> to stop tracking one.`))
  info(chalk.gray(`\n${allTokens.length} total token(s) tracked on ${chain}`))
}

/**
 * List tokens for a chain
 */
export async function listTokens(ctx: CommandContext, chain: Chain): Promise<void> {
  const vault = await ctx.ensureActiveVault()

  const spinner = createSpinner(`Loading tokens for ${chain}...`)
  const tokens = vault.getTokens(chain)
  spinner.succeed(`Tokens loaded for ${chain}`)

  if (isJsonOutput()) {
    outputJson({ chain, tokens: tokens || [] })
    return
  }

  if (!tokens || tokens.length === 0) {
    warn(`\nNo tokens configured for ${chain}`)
    info(chalk.gray(`\nUse --add <contractAddress> to add a token`))
  } else {
    printResult(chalk.cyan(`\nTokens for ${chain}:\n`))
    const table = tokens.map(token => ({
      Symbol: token.symbol,
      Name: token.name,
      Contract: token.contractAddress || 'N/A',
      Decimals: token.decimals,
      Native: token.isNative ? 'Yes' : 'No',
    }))
    printTable(table)
    info(chalk.gray(`\nUse --add <contractAddress> to add or --remove <tokenId> to remove`))
  }
}
