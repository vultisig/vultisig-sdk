import chalk from "chalk";

/**
 * Display addresses in a formatted table
 */
export function displayAddresses(addresses: Record<string, string>): void {
  console.log(chalk.cyan("\nVault Addresses:\n"));

  const table = Object.entries(addresses).map(([chain, address]) => ({
    Chain: chain,
    Address: address,
  }));

  console.table(table);
}
