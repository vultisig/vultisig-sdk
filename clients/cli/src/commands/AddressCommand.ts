import * as fs from "fs";
import * as path from "path";

// SDK will be made available globally by the launcher
declare const Vultisig: any;
import { DaemonManager } from "../daemon/DaemonManager";
import { getVaultConfig } from "../utils/env";

export type AddressOptions = {
  network?: string;
  vault?: string;
  password?: string;
};

export class AddressCommand {
  readonly description = "Show wallet addresses for supported networks";

  async run(options: AddressOptions): Promise<void> {
    console.log("🔍 Querying addresses...");

    // Parse requested networks
    const networks = options.network || "all";
    const requestedChains = this.parseNetworks(networks);

    // Get vault configuration with automatic fallback logic
    const vaultConfig = getVaultConfig(options.vault, options.password);

    // Check if daemon is running or if we need to load vault directly
    const daemonManager = new DaemonManager();
    let shouldLoadDirectly = false;

    if (vaultConfig.vaultName || vaultConfig.vaultPassword) {
      shouldLoadDirectly = await daemonManager.autoStartDaemonIfNeeded({
        vault: vaultConfig.vaultName,
        password: vaultConfig.vaultPassword,
      });
    }

    // If daemon is running, get addresses from it
    if (!shouldLoadDirectly) {
      try {
        const addresses = await daemonManager.addresses(requestedChains);

        console.log("\n=== Addresses (from daemon) ===");
        for (const [chainKey, address] of Object.entries(addresses)) {
          const chainName = this.getChainName(chainKey);
          if (address.startsWith("Error:")) {
            console.log(`  ❌ ${chainName}: ${address}`);
          } else {
            console.log(`  ✅ ${chainName}: ${address}`);
          }
        }

        console.log("\n💡 Addresses retrieved from running daemon");
        return;
      } catch {
        // Daemon not running, continue to direct vault loading
        shouldLoadDirectly = true;
      }
    }

    // Load vault directly for this operation
    if (
      shouldLoadDirectly &&
      (vaultConfig.vaultName || vaultConfig.vaultPassword)
    ) {
      try {
        await daemonManager.performEphemeralOperation(
          {
            vault: vaultConfig.vaultName,
            password: vaultConfig.vaultPassword,
          },
          async (vault) => {
            console.log("\n=== Addresses (ephemeral vault) ===");
            for (const chain of requestedChains) {
              try {
                const address = await vault.address(chain);
                const chainName = this.getChainName(chain);
                console.log(`  ✅ ${chainName}: ${address}`);
              } catch (error) {
                const chainName = this.getChainName(chain);
                console.log(
                  `  ❌ ${chainName}: Error - ${error instanceof Error ? error.message : "Unknown error"}`,
                );
              }
            }

            console.log(
              "\n💡 Addresses retrieved from ephemeral vault operation",
            );
            return true;
          },
        );
        return;
      } catch (error) {
        console.log(
          "⚠️  Could not perform ephemeral vault operation:",
          error instanceof Error ? error.message : error,
        );
      }
    }

    // Try to use Vultisig SDK to get active vault
    try {
      const sdk = new Vultisig();
      const activeVault = sdk.getActiveVault();

      if (activeVault) {
        console.log("\n=== Addresses (from active vault) ===");

        const chains = requestedChains;
        for (const chain of chains) {
          try {
            const address = await activeVault.address(chain);
            const chainName = this.getChainName(chain);
            console.log(`  ✅ ${chainName}: ${address}`);
          } catch (error) {
            const chainName = this.getChainName(chain);
            console.log(
              `  ❌ ${chainName}: Error - ${error instanceof Error ? error.message : "Unknown error"}`,
            );
          }
        }

        console.log("\n💡 Addresses retrieved from active vault");
        return;
      }
    } catch {
      // No active vault available, continue to vault loading
    }

    // No daemon and no active vault - try to load a vault
    console.log("ℹ️  No active vault found, trying to load vault...");

    try {
      // Find available vault files
      const vaultFiles = this.findVaultFiles();

      if (vaultFiles.length === 0) {
        console.log("❌ No vault files found.");
        console.log(
          '   Place .vult files in the vaults/ directory or start daemon with "vultisig run"',
        );
        return;
      }

      // Use the first unencrypted vault we find
      let vaultToLoad = null;
      for (const vaultFile of vaultFiles) {
        if (vaultFile.includes("NoPassword")) {
          vaultToLoad = vaultFile;
          break;
        }
      }

      if (!vaultToLoad) {
        vaultToLoad = vaultFiles[0]; // Use first available
      }

      console.log("📂 Loading vault:", path.basename(vaultToLoad));

      // Load vault file using the new SDK API
      const fileBuffer = fs.readFileSync(vaultToLoad);
      const file = new File([fileBuffer], path.basename(vaultToLoad));
      // Set buffer property like in the tests
      (file as any).buffer = fileBuffer;

      // Create SDK instance and add vault
      const sdk = new Vultisig();
      const vault = await sdk.addVault(file);

      console.log("\n=== Addresses (from loaded vault) ===");

      const chains = requestedChains;
      for (const chain of chains) {
        try {
          const address = await vault.address(chain);
          const chainName = this.getChainName(chain);
          console.log(`  ✅ ${chainName}: ${address}`);
        } catch (error) {
          const chainName = this.getChainName(chain);
          console.log(
            `  ❌ ${chainName}: Error - ${error instanceof Error ? error.message : "Unknown error"}`,
          );
        }
      }

      console.log("\n💡 Addresses derived from vault file");
      return;
    } catch (error) {
      console.log("❌ Failed to load vault:", error.message);
    }

    // Final fallback
    console.error("❌ No active vault found and no daemon running.");
    console.error(
      '   Start daemon with "vultisig run" first, or load a vault.',
    );
    process.exit(1);
  }

  private parseNetworks(networks: string): string[] {
    if (networks === "all") {
      return ["bitcoin", "ethereum", "solana", "litecoin", "dogecoin"];
    }

    return networks.split(",").map((n) => n.trim().toLowerCase());
  }

  private getChainName(chain: string): string {
    const names: Record<string, string> = {
      bitcoin: "Bitcoin",
      ethereum: "Ethereum",
      solana: "Solana",
      litecoin: "Litecoin",
      dogecoin: "Dogecoin",
    };
    return names[chain.toLowerCase()] || chain;
  }

  private findVaultFiles(): string[] {
    const vaultsDir = path.resolve("vaults");
    if (!fs.existsSync(vaultsDir)) {
      return [];
    }

    const files = fs.readdirSync(vaultsDir);
    return files
      .filter((file) => file.endsWith(".vult"))
      .map((file) => path.resolve(vaultsDir, file));
  }
}
