import chalk from "chalk";

export type VaultStatus = {
  name: string;
  id: string;
  type: string;
  isUnlocked: boolean;
  timeRemaining?: number;
  timeRemainingFormatted?: string;
  createdAt: number;
  lastModified: number;
  threshold: number;
  totalSigners: number;
  libType: string;
  isEncrypted: boolean;
  isBackedUp: boolean;
  chains: number;
  currency: string;
  availableSigningModes: string[];
};

/**
 * Format time remaining in milliseconds to "Xm Ys" format
 */
export function formatTimeRemaining(timeMs: number): string {
  const minutes = Math.floor(timeMs / 60000);
  const seconds = Math.floor((timeMs % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/**
 * Display lock confirmation
 */
export function displayLocked(): void {
  console.log(chalk.green("✓ Vault locked"));
}

/**
 * Display unlock confirmation
 */
export function displayUnlocked(timeRemainingFormatted: string): void {
  console.log(
    chalk.green(`✓ Vault unlocked (valid for ${timeRemainingFormatted})`),
  );
}

/**
 * Display vault status
 */
export function displayStatus(status: VaultStatus): void {
  console.log(
    chalk.cyan("\n╔════════════════════════════════════════════════╗"),
  );
  console.log(chalk.cyan("║              Vault Status                      ║"));
  console.log(
    chalk.cyan("╚════════════════════════════════════════════════╝\n"),
  );

  // Basic info
  console.log(chalk.bold("Basic Information:"));
  console.log(`  Name:          ${chalk.green(status.name)}`);
  console.log(`  ID:            ${status.id}`);
  console.log(`  Type:          ${chalk.yellow(status.type)}`);
  console.log(
    `  Created:       ${new Date(status.createdAt).toLocaleString()}`,
  );
  console.log(
    `  Last Modified: ${new Date(status.lastModified).toLocaleString()}`,
  );

  // Lock status
  console.log(chalk.bold("\nLock Status:"));
  console.log(
    `  Status:        ${status.isUnlocked ? chalk.green("Unlocked 🔓") : chalk.yellow("Locked 🔒")}`,
  );
  if (status.isUnlocked && status.timeRemainingFormatted) {
    console.log(
      `  TTL:           ${chalk.blue(status.timeRemainingFormatted)} remaining`,
    );
  }

  // Security info
  console.log(chalk.bold("\nSecurity:"));
  console.log(
    `  Encrypted:     ${status.isEncrypted ? chalk.green("Yes") : chalk.gray("No")}`,
  );
  console.log(
    `  Backed Up:     ${status.isBackedUp ? chalk.green("Yes") : chalk.yellow("No")}`,
  );

  // MPC info
  console.log(chalk.bold("\nMPC Configuration:"));
  console.log(`  Library Type:  ${status.libType}`);
  console.log(
    `  Threshold:     ${chalk.cyan(status.threshold)} of ${chalk.cyan(status.totalSigners)}`,
  );

  // Signing modes
  console.log(chalk.bold("\nSigning Modes:"));
  status.availableSigningModes.forEach((mode) => {
    console.log(`  • ${mode}`);
  });

  // Portfolio info
  console.log(chalk.bold("\nPortfolio:"));
  console.log(`  Chains:        ${status.chains}`);
  console.log(`  Currency:      ${status.currency.toUpperCase()}`);

  console.log(chalk.gray('\nUse "lock" to lock or "unlock" to unlock vault'));
}

/**
 * Display export confirmation
 */
export function displayExported(fileName: string): void {
  console.log(chalk.green("\n✓ Vault exported successfully!"));
  console.log(chalk.blue(`File: ${fileName}`));
}
