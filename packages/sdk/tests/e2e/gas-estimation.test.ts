/**
 * E2E Tests: Gas Estimation (Production)
 *
 * These tests use a pre-created persistent fast vault to test real gas
 * estimation operations against production blockchain RPCs. No transactions
 * are broadcast - only read-only gas price queries are performed.
 *
 * Environment: Production (mainnet RPCs)
 * Safety: Read-only operations, no fund transfers
 *
 * SECURITY: See SECURITY.md for vault setup instructions.
 * - Vault credentials loaded from environment variables (TEST_VAULT_PATH, TEST_VAULT_PASSWORD)
 * - Falls back to public test vault (read-only tests only - NEVER fund these addresses!)
 */

import { loadTestVault, verifyTestVault } from "@helpers/test-vault";
import { beforeAll, describe, expect, it } from "vitest";

import { Chain, VaultBase } from "@/index";

describe("E2E: Gas Estimation (Production)", () => {
  let vault: VaultBase;

  beforeAll(async () => {
    console.log("📦 Loading persistent test vault...");
    const result = await loadTestVault();
    vault = result.vault;
    verifyTestVault(vault);
  });

  describe("EVM Chain Gas Estimation", () => {
    it("should estimate Ethereum gas (EIP-1559)", async () => {
      console.log("⛽ Estimating Ethereum gas...");

      try {
        const gasInfo = await vault.gas(Chain.Ethereum);
        // If we get here, the test passed - continue as normal
        expect(gasInfo).toBeDefined();
      } catch (error) {
        console.error("\n🔴 DETAILED ERROR INFO:");
        console.error("Error name:", (error as Error)?.name);
        console.error("Error message:", (error as Error)?.message);
        console.error("Error stack:", (error as Error)?.stack);
        if (error && typeof error === "object" && "cause" in error) {
          console.error("\n🔍 Root cause:");
          console.error("Cause:", (error as any).cause);
          console.error(
            "Cause message:",
            ((error as any).cause as Error)?.message,
          );
          console.error("Cause stack:", ((error as any).cause as Error)?.stack);
        }
        throw error;
      }

      const gasInfo = await vault.gas(Chain.Ethereum);

      expect(gasInfo).toBeDefined();
      expect(gasInfo.gasLimit).toBeTypeOf("bigint");
      expect(gasInfo.maxFeePerGas).toBeTypeOf("bigint");
      expect(gasInfo.maxPriorityFeePerGas).toBeTypeOf("bigint");
      expect(gasInfo.estimatedCost).toBeTypeOf("bigint");
      expect(Number(gasInfo.estimatedCost)).toBeGreaterThan(0);

      console.log(`  Gas Limit: ${gasInfo.gasLimit}`);
      console.log(`  Max Fee: ${gasInfo.maxFeePerGas} wei`);
      console.log(`  Priority Fee: ${gasInfo.maxPriorityFeePerGas} wei`);
      console.log(`  Estimated Cost: ${gasInfo.estimatedCost} wei`);

      if (gasInfo.estimatedCostUSD) {
        console.log(
          `  Estimated Cost: $${gasInfo.estimatedCostUSD.toFixed(4)}`,
        );
      }
    });

    it("should estimate BSC gas", async () => {
      console.log("⛽ Estimating BSC gas...");

      const gasInfo = await vault.gas(Chain.BSC);

      expect(gasInfo).toBeDefined();
      expect(gasInfo.gasLimit).toBeTypeOf("bigint");
      expect(gasInfo.maxFeePerGas).toBeTypeOf("bigint");
      expect(Number(gasInfo.estimatedCost)).toBeGreaterThan(0);

      console.log(`  Gas Limit: ${gasInfo.gasLimit}`);
      console.log(`  Max Fee: ${gasInfo.maxFeePerGas} wei`);
      console.log(`  Estimated Cost: ${gasInfo.estimatedCost} wei`);
    });

    it("should estimate Polygon gas", async () => {
      console.log("⛽ Estimating Polygon gas...");

      const gasInfo = await vault.gas(Chain.Polygon);

      expect(gasInfo).toBeDefined();
      expect(gasInfo.gasLimit).toBeTypeOf("bigint");
      expect(gasInfo.maxFeePerGas).toBeTypeOf("bigint");
      expect(Number(gasInfo.estimatedCost)).toBeGreaterThan(0);

      console.log(`  Gas Limit: ${gasInfo.gasLimit}`);
      console.log(`  Max Fee: ${gasInfo.maxFeePerGas} wei`);
      console.log(`  Estimated Cost: ${gasInfo.estimatedCost} wei`);
    });

    it("should estimate Avalanche gas", async () => {
      console.log("⛽ Estimating Avalanche gas...");

      const gasInfo = await vault.gas(Chain.Avalanche);

      expect(gasInfo).toBeDefined();
      expect(gasInfo.gasLimit).toBeTypeOf("bigint");
      expect(gasInfo.maxFeePerGas).toBeTypeOf("bigint");
      expect(Number(gasInfo.estimatedCost)).toBeGreaterThan(0);

      console.log(`  Estimated Cost: ${gasInfo.estimatedCost} wei`);
    });

    it("should estimate Arbitrum gas (L2)", async () => {
      console.log("⛽ Estimating Arbitrum gas...");

      const gasInfo = await vault.gas(Chain.Arbitrum);

      expect(gasInfo).toBeDefined();
      expect(gasInfo.gasLimit).toBeTypeOf("bigint");
      expect(gasInfo.maxFeePerGas).toBeTypeOf("bigint");
      expect(Number(gasInfo.estimatedCost)).toBeGreaterThan(0);

      console.log(`  Estimated Cost: ${gasInfo.estimatedCost} wei`);
    });

    it("should estimate Optimism gas (L2)", async () => {
      console.log("⛽ Estimating Optimism gas...");

      const gasInfo = await vault.gas(Chain.Optimism);

      expect(gasInfo).toBeDefined();
      expect(gasInfo.gasLimit).toBeTypeOf("bigint");
      expect(gasInfo.maxFeePerGas).toBeTypeOf("bigint");
      expect(Number(gasInfo.estimatedCost)).toBeGreaterThan(0);

      console.log(`  Estimated Cost: ${gasInfo.estimatedCost} wei`);
    });

    it("should estimate Base gas (L2)", async () => {
      console.log("⛽ Estimating Base gas...");

      const gasInfo = await vault.gas(Chain.Base);

      expect(gasInfo).toBeDefined();
      expect(gasInfo.gasLimit).toBeTypeOf("bigint");
      expect(gasInfo.maxFeePerGas).toBeTypeOf("bigint");
      expect(Number(gasInfo.estimatedCost)).toBeGreaterThan(0);

      console.log(`  Estimated Cost: ${gasInfo.estimatedCost} wei`);
    });
  });

  describe("UTXO Chain Fee Estimation", () => {
    it("should estimate Bitcoin fees", async () => {
      console.log("⛽ Estimating Bitcoin fees...");

      const gasInfo = await vault.gas(Chain.Bitcoin);

      expect(gasInfo).toBeDefined();
      expect(gasInfo.estimatedCost).toBeDefined();
      expect(Number(gasInfo.estimatedCost)).toBeGreaterThan(0);

      console.log(`  Estimated Fee: ${gasInfo.estimatedCost} satoshis`);

      if (gasInfo.estimatedCostUSD) {
        console.log(
          `  Estimated Cost: $${gasInfo.estimatedCostUSD.toFixed(4)}`,
        );
      }
    });

    it("should estimate Litecoin fees", async () => {
      console.log("⛽ Estimating Litecoin fees...");

      const gasInfo = await vault.gas(Chain.Litecoin);

      expect(gasInfo).toBeDefined();
      expect(gasInfo.estimatedCost).toBeDefined();
      expect(Number(gasInfo.estimatedCost)).toBeGreaterThan(0);

      console.log(`  Estimated Fee: ${gasInfo.estimatedCost} satoshis`);
    });

    it("should estimate Dogecoin fees", async () => {
      console.log("⛽ Estimating Dogecoin fees...");

      const gasInfo = await vault.gas(Chain.Dogecoin);

      expect(gasInfo).toBeDefined();
      expect(gasInfo.estimatedCost).toBeDefined();
      expect(Number(gasInfo.estimatedCost)).toBeGreaterThan(0);

      console.log(`  Estimated Fee: ${gasInfo.estimatedCost} satoshis`);
    });
  });

  describe("Other Chain Gas Estimation", () => {
    it("should estimate Solana transaction fee", async () => {
      console.log("⛽ Estimating Solana fee...");

      const gasInfo = await vault.gas(Chain.Solana);

      expect(gasInfo).toBeDefined();
      expect(gasInfo.estimatedCost).toBeDefined();
      expect(Number(gasInfo.estimatedCost)).toBeGreaterThan(0);

      console.log(`  Estimated Fee: ${gasInfo.estimatedCost} lamports`);

      if (gasInfo.estimatedCostUSD) {
        console.log(
          `  Estimated Cost: $${gasInfo.estimatedCostUSD.toFixed(6)}`,
        );
      }
    });

    it("should estimate THORChain gas", async () => {
      console.log("⛽ Estimating THORChain gas...");

      const gasInfo = await vault.gas(Chain.THORChain);

      expect(gasInfo).toBeDefined();
      expect(gasInfo.estimatedCost).toBeDefined();
      expect(Number(gasInfo.estimatedCost)).toBeGreaterThan(0);

      console.log(`  Estimated Gas: ${gasInfo.estimatedCost}`);
    });

    it("should estimate Cosmos gas", async () => {
      console.log("⛽ Estimating Cosmos gas...");

      const gasInfo = await vault.gas(Chain.Cosmos);

      expect(gasInfo).toBeDefined();
      expect(gasInfo.estimatedCost).toBeDefined();
      expect(Number(gasInfo.estimatedCost)).toBeGreaterThan(0);

      console.log(`  Estimated Gas: ${gasInfo.estimatedCost}`);
    });

    it("should estimate Osmosis gas", async () => {
      console.log("⛽ Estimating Osmosis gas...");

      const gasInfo = await vault.gas(Chain.Osmosis);

      expect(gasInfo).toBeDefined();
      expect(gasInfo.estimatedCost).toBeDefined();
      expect(Number(gasInfo.estimatedCost)).toBeGreaterThan(0);

      console.log(`  Estimated Gas: ${gasInfo.estimatedCost}`);
    });
  });

  describe("Gas Comparison", () => {
    it("should compare gas costs across EVM chains", async () => {
      console.log("⛽ Comparing EVM chain gas costs...");

      const evmChains = [
        Chain.Ethereum,
        Chain.BSC,
        Chain.Polygon,
        Chain.Arbitrum,
        Chain.Optimism,
        Chain.Base,
      ];
      const gasCosts: Record<string, bigint> = {};

      for (const chain of evmChains) {
        const gasInfo = await vault.gas(chain);
        gasCosts[chain] = gasInfo.estimatedCost || 0n;
        console.log(`  ${chain}: ${gasInfo.estimatedCost} wei`);
      }

      // All chains should have positive gas estimates
      for (const chain of evmChains) {
        expect(Number(gasCosts[chain])).toBeGreaterThan(0);
      }

      // L2s should generally be cheaper than Ethereum (but not always guaranteed)
      console.log(
        `\n  Note: L2s (Arbitrum, Optimism, Base) typically have lower gas costs than Ethereum mainnet`,
      );
    }, 30000);

    it("should validate gas estimation response structure", async () => {
      const gasInfo = await vault.gas(Chain.Ethereum);

      // Verify response has expected structure
      expect(gasInfo).toHaveProperty("estimatedCost");
      expect(gasInfo).toHaveProperty("gasLimit");
      expect(gasInfo).toHaveProperty("maxFeePerGas");
      expect(gasInfo).toHaveProperty("maxPriorityFeePerGas");

      // Validate types according to GasInfo type definitions
      if (gasInfo.gasLimit) expect(typeof gasInfo.gasLimit).toBe("bigint");
      if (gasInfo.gasPrice) expect(typeof gasInfo.gasPrice).toBe("string"); // gasPrice is string in BaseGasInfo
      if (gasInfo.maxFeePerGas)
        expect(typeof gasInfo.maxFeePerGas).toBe("bigint");
      if (gasInfo.maxPriorityFeePerGas)
        expect(typeof gasInfo.maxPriorityFeePerGas).toBe("bigint");
      if (gasInfo.estimatedCost)
        expect(typeof gasInfo.estimatedCost).toBe("bigint");
    });
  });

  describe("Error Handling", () => {
    it("should handle unsupported chain gracefully", async () => {
      await expect(vault.gas("UnsupportedChain" as any)).rejects.toThrow();
    });
  });
});
