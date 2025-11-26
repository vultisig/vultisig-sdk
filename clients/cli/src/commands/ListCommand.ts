import * as fs from "fs";
import * as path from "path";
// SDK will be made available globally by the launcher
declare const Vultisig: any;

// Polyfill File for Node.js
if (typeof File === "undefined") {
  global.File = class File {
    constructor(
      public chunks: any[],
      public name: string,
      public options?: any,
    ) {}
    arrayBuffer() {
      return Promise.resolve(
        Buffer.concat(this.chunks.map((chunk) => Buffer.from(chunk))),
      );
    }
  } as any;
}
import { findVultFiles, getVaultsDir } from "../utils/paths";

export class ListCommand {
  readonly description = "List available vault files";

  async run(): Promise<void> {
    const vaultsDir = getVaultsDir();

    try {
      await fs.promises.access(vaultsDir);
    } catch {
      console.log(`📁 Vaults directory not found. Creating: ${vaultsDir}`);
      await fs.promises.mkdir(vaultsDir, { recursive: true });
      console.log("✅ Created vaults directory");
      console.log("\nNext steps:");
      console.log("1. Place your .vult vault files in:", vaultsDir);
      console.log('2. Run "vultisig list" again to see your vaults');
      console.log("3. Start the daemon: vultisig run");
      return;
    }

    const vultFiles = await findVultFiles(vaultsDir);

    if (vultFiles.length === 0) {
      console.log(`📁 No vault files found in: ${vaultsDir}`);
      console.log(
        "\nPlace your .vult files in this directory to use them with the CLI.",
      );
      return;
    }

    console.log(`📁 Found ${vultFiles.length} vault file(s) in ${vaultsDir}:`);

    for (const filePath of vultFiles) {
      try {
        const fileName = path.basename(filePath);
        const isEncrypted =
          fileName.toLowerCase().includes("password") &&
          !fileName.toLowerCase().includes("nopassword");
        const status = isEncrypted ? "🔐 encrypted" : "🔓 unencrypted";

        console.log(`  📄 ${path.basename(filePath)} (${status})`);
      } catch (error) {
        console.log(
          `  📄 ${path.basename(filePath)} (❓ unknown - ${error instanceof Error ? error.message : "error"})`,
        );
      }
    }

    try {
      const sdk = new Vultisig();
      const activeVault = sdk.getActiveVault();
      if (activeVault) {
        const summary = activeVault.summary();
        console.log(`\n📍 Active vault: ${summary.name} (${summary.type})`);
      }
    } catch {
      // No active vault
    }
  }
}
