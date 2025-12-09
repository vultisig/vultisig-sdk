/**
 * Token Commands - token management
 */
import type { Chain } from '@vultisig/sdk'
import chalk from 'chalk'

import type { CommandContext } from '../core'
import { replPrompt } from '../interactive'
import { createSpinner, info, isJsonOutput, outputJson, printResult, printTable, success, warn } from '../lib/output'

export type TokensOptions = {
  chain: Chain
  add?: string // contract address
  remove?: string // token ID
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

  if (options.add) {
    // Use CLI options if provided, otherwise prompt
    let symbol = options.symbol
    let name = options.name
    let decimals = options.decimals

    // Prompt one at a time to avoid duplicate rendering issues
    if (!symbol) {
      const symbolAnswer = await replPrompt([
        {
          type: 'input',
          name: 'symbol',
          message: 'Enter token symbol (e.g., USDT):',
          validate: (input: string) => input.trim() !== '' || 'Symbol is required',
        },
      ])
      symbol = symbolAnswer.symbol?.trim()
    }
    if (!name) {
      const nameAnswer = await replPrompt([
        {
          type: 'input',
          name: 'name',
          message: 'Enter token name (e.g., Tether USD):',
          validate: (input: string) => input.trim() !== '' || 'Name is required',
        },
      ])
      name = nameAnswer.name?.trim()
    }
    if (decimals === undefined) {
      const decimalsAnswer = await replPrompt([
        {
          type: 'number',
          name: 'decimals',
          message: 'Enter token decimals:',
          default: 18,
          validate: (input: number) => input >= 0 || 'Decimals must be non-negative',
        },
      ])
      decimals = decimalsAnswer.decimals
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

  await vault.addToken(options.chain, {
    id: `${options.chain}-${options.contractAddress}`,
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

  await vault.removeToken(chain, tokenId)
  success(`\n+ Removed token ${tokenId} from ${chain}`)
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
