import { Chain, Token } from "@vultisig/sdk";
import chalk from "chalk";

/**
 * Display list of tokens
 */
export function displayTokens(chain: Chain, tokens: Token[]): void {
  if (!tokens || tokens.length === 0) {
    console.log(chalk.yellow(`\nNo tokens configured for ${chain}`));
    console.log(
      chalk.gray('\nUse "token add <chain> <address>" to add a token'),
    );
  } else {
    console.log(chalk.cyan(`\nTokens for ${chain}:\n`));
    const table = tokens.map((token) => ({
      Symbol: token.symbol,
      Contract: token.contractAddress,
      Decimals: token.decimals,
      Native: token.isNative ? "Yes" : "No",
    }));
    console.table(table);
    console.log(
      chalk.gray(
        '\nUse "token add <chain> <address>" to add or "token remove <chain> <tokenId>" to remove',
      ),
    );
  }
}

/**
 * Display token added confirmation
 */
export function displayTokenAdded(chain: Chain, symbol: string): void {
  console.log(chalk.green(`\n✓ Added token ${symbol} on ${chain}`));
}

/**
 * Display token removed confirmation
 */
export function displayTokenRemoved(chain: Chain, tokenId: string): void {
  console.log(chalk.green(`\n✓ Removed token ${tokenId} from ${chain}`));
}
