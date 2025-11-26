/**
 * Integration Test: Swap Quote Functionality
 *
 * Tests the swap quote flow through the SDK's public API.
 * Uses mocked core swap functions to test SDK integration.
 *
 * Test Coverage:
 * - Getting swap quotes via VaultBase.getSwapQuote()
 * - Chain support queries
 * - Token allowance checks
 * - Event emission
 *
 * NOTE: Integration setup (WASM & crypto polyfills) loaded via vitest.config.ts
 */

import { Chain } from "@core/chain/Chain";
import type { Vault as CoreVault } from "@core/mpc/vault/Vault";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { GlobalConfig } from "../../../src/config/GlobalConfig";
import { GlobalServerManager } from "../../../src/server/GlobalServerManager";
import { FastSigningService } from "../../../src/services/FastSigningService";
import { PasswordCacheService } from "../../../src/services/PasswordCacheService";
import { GlobalStorage } from "../../../src/storage/GlobalStorage";
import { MemoryStorage } from "../../../src/storage/MemoryStorage";
import { FastVault } from "../../../src/vault/FastVault";
import type { SwapQuoteResult } from "../../../src/vault/swap-types";

// Mock the core swap functions
vi.mock("@core/chain/swap/quote/findSwapQuote", () => ({
  findSwapQuote: vi.fn(),
}));

vi.mock("@core/chain/chains/evm/erc20/getErc20Allowance", () => ({
  getErc20Allowance: vi.fn(),
}));

vi.mock("@core/chain/swap/swapEnabledChains", () => ({
  swapEnabledChains: [
    "Ethereum",
    "Bitcoin",
    "BSC",
    "Polygon",
    "THORChain",
    "MayaChain",
    "Avalanche",
    "Base",
    "Arbitrum",
  ] as const,
}));

describe("Integration: Swap Quote", () => {
  let vault: FastVault;
  let memoryStorage: MemoryStorage;
  let receivedEvents: Array<{ event: string; data: unknown }>;

  beforeAll(async () => {
    // Reset all global singletons
    GlobalStorage.reset();
    GlobalServerManager.reset();
    GlobalConfig.reset();
    PasswordCacheService.resetInstance();

    // Configure global singletons
    memoryStorage = new MemoryStorage();
    GlobalStorage.configure(memoryStorage);

    GlobalServerManager.configure({
      fastVault: "https://api.vultisig.com/vault",
      messageRelay: "https://api.vultisig.com/router",
    });

    GlobalConfig.configure({
      defaultChains: [Chain.Bitcoin, Chain.Ethereum, Chain.Solana],
      defaultCurrency: "USD",
    });

    // Create test vault
    vault = await createTestVault("Swap Integration Test");

    // Track events
    receivedEvents = [];
    vault.on("swapQuoteReceived", (data) => {
      receivedEvents.push({ event: "swapQuoteReceived", data });
    });
    vault.on("error", (data) => {
      receivedEvents.push({ event: "error", data });
    });

    console.log("✅ Integration test setup complete");
  }, 60000);

  afterAll(() => {
    vi.restoreAllMocks();
  });

  /**
   * Helper function to create a test vault
   */
  async function createTestVault(name: string): Promise<FastVault> {
    const now = Date.now();
    const mockVaultData: CoreVault = {
      name,
      publicKeys: {
        ecdsa:
          "02a1633cafcc01ebfb6d78e39f687a1f0995c62fc95f51ead10a02ee0be551b5dc",
        eddsa:
          "b5d7a8e02f3c9d1e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e",
      },
      hexChainCode:
        "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      localPartyId: "test-device",
      signers: ["test-device", "Server-1"],
      keyShares: {
        ecdsa: "mock_ecdsa_keyshare_for_testing",
        eddsa: "mock_eddsa_keyshare_for_testing",
      },
      resharePrefix: "",
      libType: "GG20",
      createdAt: now,
      isBackedUp: false,
      order: 0,
    } as CoreVault;

    const vaultData = {
      publicKeys: mockVaultData.publicKeys,
      hexChainCode: mockVaultData.hexChainCode,
      signers: mockVaultData.signers,
      localPartyId: mockVaultData.localPartyId,
      createdAt: now,
      libType: mockVaultData.libType,
      isEncrypted: false,
      type: "fast" as const,
      id: mockVaultData.publicKeys.ecdsa,
      name,
      isBackedUp: false,
      order: 0,
      lastModified: now,
      currency: "usd",
      chains: ["Bitcoin", "Ethereum", "Solana"],
      tokens: {},
      vultFileContent: "",
    };

    const mockFastSigningService = {} as FastSigningService;
    const config = GlobalConfig.getInstance();

    return FastVault.fromStorage(vaultData, mockFastSigningService, config);
  }

  describe("Chain Support Queries", () => {
    it("should report supported swap chains", () => {
      const chains = vault.getSupportedSwapChains();

      expect(chains).toBeDefined();
      expect(chains.length).toBeGreaterThan(0);
      expect(chains).toContain("Ethereum");
      expect(chains).toContain("Bitcoin");

      console.log(`✅ Supported chains: ${chains.join(", ")}`);
    });

    it("should check if swap is supported between chains", () => {
      // Supported pairs
      expect(vault.isSwapSupported(Chain.Ethereum, Chain.Bitcoin)).toBe(true);
      expect(vault.isSwapSupported(Chain.Ethereum, Chain.Ethereum)).toBe(true);
      expect(vault.isSwapSupported(Chain.BSC, Chain.Polygon)).toBe(true);

      // Unsupported pairs (Cosmos not in mock list)
      expect(vault.isSwapSupported(Chain.Cosmos, Chain.Ethereum)).toBe(false);
      expect(vault.isSwapSupported(Chain.Ethereum, Chain.Cosmos)).toBe(false);

      console.log("✅ Chain support checks working correctly");
    });
  });

  describe("Quote Fetching", () => {
    it("should get swap quote for native token swap", async () => {
      const { findSwapQuote } = await import(
        "@core/chain/swap/quote/findSwapQuote"
      );

      // Mock THORChain quote
      const mockQuote = {
        native: {
          swapChain: "THORChain" as const,
          expected_amount_out: "5000000", // 0.05 BTC in sats
          expiry: Math.floor(Date.now() / 1000) + 600,
          fees: {
            affiliate: "0",
            asset: "BTC",
            outbound: "10000",
            total: "10000",
          },
          inbound_address: "bc1q...",
          memo: "=:BTC.BTC:bc1q...",
          notes: "",
          outbound_delay_blocks: 0,
          outbound_delay_seconds: 0,
          recommended_min_amount_in: "100000000000000000",
          warning: "",
        },
      };

      vi.mocked(findSwapQuote).mockResolvedValue(mockQuote as any);

      receivedEvents = [];

      const quote = await vault.getSwapQuote({
        fromCoin: {
          chain: Chain.Ethereum,
          address: "0x1234567890abcdef1234567890abcdef12345678",
          ticker: "ETH",
          decimals: 18,
        },
        toCoin: {
          chain: Chain.Bitcoin,
          address: "bc1qtest...",
          ticker: "BTC",
          decimals: 8,
        },
        amount: 1.0,
      });

      expect(quote).toBeDefined();
      expect(quote.provider).toBe("thorchain");
      expect(quote.estimatedOutput).toBeDefined();
      expect(quote.expiresAt).toBeGreaterThan(Date.now());
      expect(quote.requiresApproval).toBe(false);
      expect(quote.fees).toBeDefined();

      // Verify event was emitted
      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0].event).toBe("swapQuoteReceived");

      console.log(
        `✅ Quote received: ${quote.estimatedOutput} BTC via ${quote.provider}`,
      );
    });

    it("should get swap quote with approval required for ERC-20", async () => {
      const { findSwapQuote } = await import(
        "@core/chain/swap/quote/findSwapQuote"
      );
      const { getErc20Allowance } = await import(
        "@core/chain/chains/evm/erc20/getErc20Allowance"
      );

      // Mock 1inch quote
      const mockQuote = {
        general: {
          dstAmount: "1000000000000000000", // 1 ETH
          provider: "1inch" as const,
          tx: {
            evm: {
              from: "0x1234...",
              to: "0x1111111254fb6c44bAC0beD2854e76F90643097d",
              data: "0x...",
              value: "0",
              gasLimit: 300000n,
            },
          },
        },
      };

      vi.mocked(findSwapQuote).mockResolvedValue(mockQuote);
      vi.mocked(getErc20Allowance).mockResolvedValue(0n); // No allowance

      receivedEvents = [];

      const quote = await vault.getSwapQuote({
        fromCoin: {
          chain: Chain.Ethereum,
          address: "0x1234567890abcdef1234567890abcdef12345678",
          id: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC
          ticker: "USDC",
          decimals: 6,
        },
        toCoin: {
          chain: Chain.Ethereum,
          address: "0x1234567890abcdef1234567890abcdef12345678",
          ticker: "ETH",
          decimals: 18,
        },
        amount: 1000, // 1000 USDC
      });

      expect(quote).toBeDefined();
      expect(quote.provider).toBe("1inch");
      expect(quote.requiresApproval).toBe(true);
      expect(quote.approvalInfo).toBeDefined();
      expect(quote.approvalInfo?.spender).toBe(
        "0x1111111254fb6c44bAC0beD2854e76F90643097d",
      );

      console.log(
        `✅ Quote requires approval for ${quote.approvalInfo?.requiredAmount} units`,
      );
    });

    it("should handle quote errors gracefully", async () => {
      const { findSwapQuote } = await import(
        "@core/chain/swap/quote/findSwapQuote"
      );

      vi.mocked(findSwapQuote).mockRejectedValue(
        new Error("No swap routes available"),
      );

      receivedEvents = [];

      await expect(
        vault.getSwapQuote({
          fromCoin: { chain: Chain.Ethereum },
          toCoin: { chain: Chain.Bitcoin },
          amount: 0.0001, // Very small amount
        }),
      ).rejects.toThrow("No swap route");

      // Verify error event was emitted
      expect(receivedEvents.some((e) => e.event === "error")).toBe(true);

      console.log("✅ Error handling working correctly");
    });
  });

  describe("Token Allowance", () => {
    it("should get token allowance for ERC-20", async () => {
      const { getErc20Allowance } = await import(
        "@core/chain/chains/evm/erc20/getErc20Allowance"
      );

      vi.mocked(getErc20Allowance).mockResolvedValue(1000000000n); // 1000 USDC

      const allowance = await vault.getTokenAllowance(
        {
          chain: Chain.Ethereum,
          address: "0x1234567890abcdef1234567890abcdef12345678",
          id: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
          ticker: "USDC",
          decimals: 6,
        },
        "0x1111111254fb6c44bAC0beD2854e76F90643097d",
      );

      expect(allowance).toBe(1000000000n);

      console.log(`✅ Token allowance: ${allowance}`);
    });

    it("should return 0 for native token allowance", async () => {
      const allowance = await vault.getTokenAllowance(
        {
          chain: Chain.Ethereum,
          address: "0x1234567890abcdef1234567890abcdef12345678",
          ticker: "ETH",
          decimals: 18,
        },
        "0x1111111254fb6c44bAC0beD2854e76F90643097d",
      );

      expect(allowance).toBe(0n);

      console.log("✅ Native token allowance is 0");
    });
  });

  describe("Quote Result Structure", () => {
    it("should return properly formatted quote result", async () => {
      const { findSwapQuote } = await import(
        "@core/chain/swap/quote/findSwapQuote"
      );

      const mockQuote = {
        native: {
          swapChain: "THORChain" as const,
          expected_amount_out: "100000000", // 1 BTC
          expiry: Math.floor(Date.now() / 1000) + 600,
          fees: {
            affiliate: "50000",
            asset: "BTC",
            outbound: "100000",
            total: "150000",
          },
          inbound_address: "bc1q...",
          memo: "=:BTC.BTC:bc1q...",
          notes: "",
          outbound_delay_blocks: 0,
          outbound_delay_seconds: 0,
          recommended_min_amount_in: "100000000000000000",
          warning: "Slippage may be high",
        },
      };

      vi.mocked(findSwapQuote).mockResolvedValue(mockQuote as any);

      const quote: SwapQuoteResult = await vault.getSwapQuote({
        fromCoin: {
          chain: Chain.Ethereum,
          address: "0x1234...",
          ticker: "ETH",
          decimals: 18,
        },
        toCoin: {
          chain: Chain.Bitcoin,
          address: "bc1q...",
          ticker: "BTC",
          decimals: 8,
        },
        amount: 10,
      });

      // Verify all required fields are present
      expect(quote.quote).toBeDefined();
      expect(quote.estimatedOutput).toBeDefined();
      expect(quote.provider).toBe("thorchain");
      expect(quote.expiresAt).toBeTypeOf("number");
      expect(quote.requiresApproval).toBeTypeOf("boolean");
      expect(quote.fees).toBeDefined();
      expect(quote.fees.network).toBeDefined();
      expect(quote.fees.total).toBeDefined();
      expect(quote.warnings).toBeInstanceOf(Array);
      expect(quote.warnings).toContain("Slippage may be high");

      console.log("✅ Quote result structure is correct");
      console.log(`   Output: ${quote.estimatedOutput} BTC`);
      console.log(`   Fees: ${quote.fees.total}`);
      console.log(`   Warnings: ${quote.warnings.join(", ") || "none"}`);
    });
  });
});
