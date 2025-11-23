import { Chain, Token, VaultBase } from '@vultisig/sdk'
import chalk from 'chalk'

/**
 * Add a token to a chain
 */
export async function handleAddToken(
  vault: VaultBase,
  chain: Chain,
  token: Token
): Promise<void> {
  await vault.addToken(chain, token)
}

/**
 * Remove a token from a chain
 */
export async function handleRemoveToken(
  vault: VaultBase,
  chain: Chain,
  tokenId: string
): Promise<void> {
  await vault.removeToken(chain, tokenId)
}

/**
 * List all tokens for a chain
 */
export function handleListTokens(vault: VaultBase, chain: Chain): Token[] {
  return vault.getTokens(chain)
}

/**
 * Display list of tokens
 */
export function displayTokens(chain: Chain, tokens: Token[]): void {
  if (!tokens || tokens.length === 0) {
    console.log(chalk.yellow(`\nNo tokens configured for ${chain}`))
    console.log(
      chalk.gray('\nUse "token add <chain> <address>" to add a token')
    )
  } else {
    console.log(chalk.cyan(`\nTokens for ${chain}:\n`))
    const table = tokens.map(token => ({
      Symbol: token.symbol,
      Contract: token.contractAddress,
      Decimals: token.decimals,
      Native: token.isNativeToken ? 'Yes' : 'No',
    }))
    console.table(table)
    console.log(
      chalk.gray(
        '\nUse "token add <chain> <address>" to add or "token remove <chain> <tokenId>" to remove'
      )
    )
  }
}

/**
 * Display token added confirmation
 */
export function displayTokenAdded(chain: Chain, symbol: string): void {
  console.log(chalk.green(`\n✓ Added token ${symbol} on ${chain}`))
}

/**
 * Display token removed confirmation
 */
export function displayTokenRemoved(chain: Chain, tokenId: string): void {
  console.log(chalk.green(`\n✓ Removed token ${tokenId} from ${chain}`))
}
