// SDK will be made available globally by the launcher
declare const Vultisig: any;
import { DaemonManager } from "../daemon/DaemonManager";

export class StatusCommand {
  readonly description = "Check daemon status and connectivity";

  async run(): Promise<void> {
    console.log("🔍 Checking daemon status...");

    const daemonManager = new DaemonManager();

    try {
      await daemonManager.checkDaemonStatus();

      // If daemon is running, get additional info
      try {
        const sdk = new Vultisig();
        const activeVault = sdk.getActiveVault();
        if (activeVault) {
          const summary = activeVault.summary();
          console.log(`📍 Active vault: ${summary.name}`);
          console.log(`🔧 Type: ${summary.type}`);
          console.log(`⛓️  Chains: ${summary.chains.join(", ")}`);
        }
      } catch {
        console.log("ℹ️  No active vault found");
      }
    } catch (error) {
      console.error("❌", error instanceof Error ? error.message : error);

      // Check if there are any stored vaults
      try {
        const sdk = new Vultisig();
        const vaults = await sdk.listVaults();
        if (vaults.length > 0) {
          console.log(
            `\n💾 Found ${vaults.length} stored vault(s) available to load`,
          );
        }
      } catch {
        // Storage not initialized
      }

      process.exit(1);
    }
  }
}
