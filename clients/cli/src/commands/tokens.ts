/**
 * Token Commands - token management
 */
import type { Chain } from '@vultisig/sdk/node'
import chalk from 'chalk'
import inquirer from 'inquirer'

import type { CommandContext } from '../core'
import { createSpinner, success, warn } from '../ui'

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
      const answers = await inquirer.prompt(prompts)
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

  if (!tokens || tokens.length === 0) {
    warn(`\nNo tokens configured for ${chain}`)
    console.log(chalk.gray(`\nUse --add <contractAddress> to add a token`))
  } else {
    console.log(chalk.cyan(`\nTokens for ${chain}:\n`))
    const table = tokens.map(token => ({
      Symbol: token.symbol,
      Name: token.name,
      Contract: token.contractAddress || 'N/A',
      Decimals: token.decimals,
      Native: token.isNative ? 'Yes' : 'No',
    }))
    console.table(table)
    console.log(chalk.gray(`\nUse --add <contractAddress> to add or --remove <tokenId> to remove`))
  }
}
