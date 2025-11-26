import { VaultBase } from "@vultisig/sdk";
import chalk from "chalk";

type BufferedEvent = {
  timestamp: Date;
  message: string;
  type: "info" | "success" | "warning" | "error";
};

/**
 * Centralized event management for vault events with smart buffering.
 * Events are buffered during command execution to prevent REPL interference,
 * then displayed after the command completes.
 */
export class EventManager {
  private eventBuffer: BufferedEvent[] = [];
  private isCommandRunning = false;

  /**
   * Mark the start of a command execution.
   * Events will be buffered until endCommand() is called.
   */
  startCommand(): void {
    this.isCommandRunning = true;
    this.eventBuffer = [];
  }

  /**
   * Mark the end of a command execution.
   * Flushes any buffered events to the console.
   */
  endCommand(): void {
    this.isCommandRunning = false;
    this.flushBuffer();
  }

  /**
   * Handle an event - buffer if command is running, display immediately if idle.
   */
  private handleEvent(
    message: string,
    type: "info" | "success" | "warning" | "error" = "info",
  ): void {
    if (this.isCommandRunning) {
      this.eventBuffer.push({
        timestamp: new Date(),
        message,
        type,
      });
    } else {
      this.displayEvent(message, type);
    }
  }

  /**
   * Display a single event to the console with appropriate formatting.
   */
  private displayEvent(
    message: string,
    type: "info" | "success" | "warning" | "error",
  ): void {
    switch (type) {
      case "success":
        console.log(chalk.green(message));
        break;
      case "warning":
        console.log(chalk.yellow(message));
        break;
      case "error":
        console.error(chalk.red(message));
        break;
      case "info":
      default:
        console.log(chalk.blue(message));
        break;
    }
  }

  /**
   * Flush all buffered events to the console.
   */
  private flushBuffer(): void {
    if (this.eventBuffer.length === 0) {
      return;
    }

    console.log(chalk.gray("\n─── Background Events ───"));
    this.eventBuffer.forEach((event) => {
      const timeStr = event.timestamp.toLocaleTimeString();
      const message = `[${timeStr}] ${event.message}`;
      this.displayEvent(message, event.type);
    });
    console.log(chalk.gray("─── End Events ───\n"));
  }

  /**
   * Setup all vault event listeners in one centralized location.
   * This replaces the scattered event listener setup in VaultManager and ReplSession.
   */
  setupVaultListeners(vault: VaultBase): void {
    // Balance updates
    vault.on("balanceUpdated", ({ chain, balance, tokenId }: any) => {
      const asset = tokenId ? `${balance.symbol} token` : balance.symbol;
      this.handleEvent(
        `ℹ Balance updated for ${chain} (${asset}): ${balance.amount}`,
        "info",
      );
    });

    // Transaction broadcast
    vault.on("transactionBroadcast", ({ chain, txHash }: any) => {
      this.handleEvent(`✓ Transaction broadcast on ${chain}`, "success");
      this.handleEvent(`  TX Hash: ${txHash}`, "info");
    });

    // Chain added
    vault.on("chainAdded", ({ chain }: any) => {
      this.handleEvent(`✓ Chain added: ${chain}`, "success");
    });

    // Chain removed
    vault.on("chainRemoved", ({ chain }: any) => {
      this.handleEvent(`ℹ Chain removed: ${chain}`, "warning");
    });

    // Token added
    vault.on("tokenAdded", ({ chain, token }: any) => {
      this.handleEvent(`✓ Token added: ${token.symbol} on ${chain}`, "success");
    });

    // Values updated
    vault.on("valuesUpdated", ({ chain }: any) => {
      if (chain === "all") {
        this.handleEvent("ℹ Portfolio values updated", "info");
      } else {
        this.handleEvent(`ℹ Values updated for ${chain}`, "info");
      }
    });

    // Errors
    vault.on("error", (error: any) => {
      this.handleEvent(`✗ Vault error: ${error.message}`, "error");
    });

    // Vault unlocked (important for prompt update)
    vault.on("unlocked", () => {
      // This event is handled separately in ReplSession for prompt updates
      // We don't need to display it here
    });
  }

  /**
   * Remove all event listeners from a vault.
   * Useful for cleanup when a vault is removed.
   */
  cleanupVaultListeners(vault: VaultBase): void {
    vault.removeAllListeners("balanceUpdated");
    vault.removeAllListeners("transactionBroadcast");
    vault.removeAllListeners("chainAdded");
    vault.removeAllListeners("chainRemoved");
    vault.removeAllListeners("tokenAdded");
    vault.removeAllListeners("valuesUpdated");
    vault.removeAllListeners("error");
  }
}
