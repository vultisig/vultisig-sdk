import { Chain } from "@vultisig/sdk";
import chalk from "chalk";

/**
 * Display list of chains
 */
export function displayChains(chains: Chain[]): void {
  console.log(chalk.cyan("\nActive Chains:\n"));
  chains.forEach((chain: Chain) => {
    console.log(`  • ${chain}`);
  });
  console.log(
    chalk.gray(
      "\nUse --add <chain> to add a chain or --remove <chain> to remove one",
    ),
  );
}

/**
 * Display chain added confirmation
 */
export function displayChainAdded(chain: Chain, address: string): void {
  console.log(chalk.green(`\n✓ Added chain: ${chain}`));
  console.log(chalk.blue(`Address: ${address}`));
}

/**
 * Display chain removed confirmation
 */
export function displayChainRemoved(chain: Chain): void {
  console.log(chalk.green(`\n✓ Removed chain: ${chain}`));
}
