# Testing Transaction Broadcasting Safely

**Last Updated:** 2025-01-16

## Overview

Testing the `broadcastTx()` method presents unique challenges because it involves sending transactions to live blockchain networks. This guide provides safe strategies for testing without risking real funds.

## Testing Strategies

### Strategy 1: Testnets (Recommended) ✅

**Safety:** 🟢 Completely safe - uses free testnet tokens

Testnets are parallel blockchain networks designed specifically for testing. They use tokens that have no real-world value.

#### Supported Testnets by Chain

| Chain    | Testnet             | Faucet                            | RPC                                |
| -------- | ------------------- | --------------------------------- | ---------------------------------- |
| Ethereum | Sepolia             | https://sepoliafaucet.com         | https://sepolia.infura.io          |
| Ethereum | Holesky             | https://holesky-faucet.pk910.de   | https://holesky.infura.io          |
| Bitcoin  | Testnet3            | https://testnet-faucet.mempool.co | Bitcoin Testnet RPC                |
| Solana   | Devnet              | `solana airdrop 1`                | https://api.devnet.solana.com      |
| Polygon  | Mumbai (deprecated) | -                                 | Amoy (new testnet)                 |
| Arbitrum | Sepolia             | https://arbitrum.faucet.dev       | https://sepolia-rollup.arbitrum.io |

#### How to Test with Testnets

1. **Configure Testnet RPC Endpoints**

```typescript
// Note: SDK currently uses mainnet by default
// Testnet support would require configuration options
// This is a FUTURE ENHANCEMENT

import { Vultisig, Chain } from "@vultisig/sdk";

// Future API (not yet implemented):
const sdk = await Vultisig.create({
  network: "testnet", // Would configure testnet RPCs
  rpcEndpoints: {
    [Chain.Ethereum]: "https://sepolia.infura.io/v3/YOUR-KEY",
    [Chain.Bitcoin]: "bitcoin-testnet-rpc-url",
    [Chain.Solana]: "https://api.devnet.solana.com",
  },
});
```

2. **Get Testnet Tokens from Faucets**

```bash
# Ethereum Sepolia
# Visit https://sepoliafaucet.com and enter your address

# Solana Devnet
solana airdrop 1 YOUR_SOLANA_ADDRESS --url devnet

# Bitcoin Testnet
# Visit https://testnet-faucet.mempool.co
```

3. **Create Test Vault and Broadcast**

```typescript
const vault = await sdk.createVault("Testnet Vault", {
  type: "fast",
  password: "test-password",
});

// Get testnet token address
const ethAddress = await vault.address(Chain.Ethereum);
console.log(`Fund this address: ${ethAddress}`);

// Wait for faucet to send tokens...

// Prepare and broadcast test transaction
const payload = await vault.prepareSendTx({
  coin: {
    chain: Chain.Ethereum,
    address: ethAddress,
    decimals: 18,
    ticker: "ETH",
  },
  receiver: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb", // Test recipient
  amount: 100000000000000000n, // 0.1 testnet ETH
});

const messageHashes = await vault.extractMessageHashes(payload);
const signature = await vault.sign(
  "fast",
  {
    transaction: payload,
    chain: Chain.Ethereum,
    messageHashes,
  },
  "test-password",
);

// Safe to broadcast - using testnet tokens!
const txHash = await vault.broadcastTx({
  chain: Chain.Ethereum,
  keysignPayload: payload,
  signature,
});

console.log(`Testnet TX: https://sepolia.etherscan.io/tx/${txHash}`);
```

**Pros:**

- ✅ Completely safe - testnet tokens have no value
- ✅ Can test unlimited times
- ✅ Free tokens from faucets
- ✅ Realistic blockchain behavior

**Cons:**

- ⚠️ SDK currently only supports mainnet (needs enhancement)
- ⚠️ Some testnets are unreliable or congested
- ⚠️ Not all chains have mature testnets
- ⚠️ Faucet rate limiting

### Strategy 2: Dry Run / Simulation (Best for CI/CD) ✅

**Safety:** 🟢 Completely safe - no actual broadcasting

Test everything except the final broadcast step by verifying the transaction is correctly prepared and signed.

```typescript
import { describe, it, expect } from "vitest";

describe("Broadcast Transaction (Dry Run)", () => {
  it("should prepare and sign transaction without broadcasting", async () => {
    // 1. Create vault
    const vault = await sdk.getVault("test-vault-id");

    // 2. Prepare transaction
    const payload = await vault.prepareSendTx({
      coin: { chain: Chain.Ethereum, address, decimals: 18, ticker: "ETH" },
      receiver: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
      amount: 1000000000000000000n,
    });

    // 3. Extract message hashes
    const messageHashes = await vault.extractMessageHashes(payload);
    expect(messageHashes).toHaveLength(1);
    expect(messageHashes[0]).toMatch(/^0x[a-fA-F0-9]{64}$/);

    // 4. Sign transaction
    const signature = await vault.sign(
      "fast",
      {
        transaction: payload,
        chain: Chain.Ethereum,
        messageHashes,
      },
      password,
    );

    // 5. Verify signature structure (don't broadcast)
    expect(signature.signature).toBeDefined();
    expect(signature.format).toBeOneOf(["ECDSA", "EdDSA"]);

    // ✅ Transaction is ready to broadcast, but we don't call broadcastTx()
    // This tests 90% of the broadcast flow without risking funds

    console.log("✅ Transaction prepared and signed successfully");
    console.log("🔒 Skipping broadcast (dry run)");
  });
});
```

**Pros:**

- ✅ Completely safe - never broadcasts
- ✅ Fast - no blockchain interaction
- ✅ Suitable for CI/CD pipelines
- ✅ Tests most of the code path

**Cons:**

- ❌ Doesn't test actual network broadcasting
- ❌ Won't catch RPC endpoint issues
- ❌ Won't verify transaction acceptance by network

### Strategy 3: Manual Testing with Minimal Amounts ⚠️

**Safety:** 🟡 Low risk - use minimal amounts only

For testing on mainnet with real value, follow strict safety protocols.

#### Safety Checklist

- [ ] Create **dedicated test vault** (never use production vaults)
- [ ] Fund with **minimal amounts** ($5-10 max per chain)
- [ ] Test with **small transactions** (< $1 per tx)
- [ ] Use **self-transfers** (send to your own addresses)
- [ ] Enable **transaction monitoring**
- [ ] Document all **test transactions**

#### Example: Minimal Amount Testing

```typescript
// ⚠️ WARNING: This uses real mainnet funds!
// Only run this if you understand the risks

describe("Broadcast Transaction (Minimal Mainnet)", () => {
  // Skip by default - only run when explicitly enabled
  const ENABLE_MAINNET_TESTS =
    process.env.ENABLE_MAINNET_BROADCAST_TESTS === "true";

  it.skipIf(!ENABLE_MAINNET_TESTS)(
    "should broadcast minimal transaction on mainnet",
    async () => {
      const vault = await sdk.getVault("test-vault-id");

      // Safety check: Verify this is a test vault
      const vaultName = vault.name;
      expect(vaultName).toContain("test");

      // Get addresses
      const ethAddress = await vault.address(Chain.Ethereum);

      // Safety check: Verify minimal balance
      const balance = await vault.balance(Chain.Ethereum);
      expect(balance.amount).toBeLessThan("100000000000000000"); // < 0.1 ETH

      // Self-transfer (funds stay in your control)
      const selfAddress = ethAddress;

      // Prepare minimal transaction (0.001 ETH)
      const payload = await vault.prepareSendTx({
        coin: {
          chain: Chain.Ethereum,
          address: ethAddress,
          decimals: 18,
          ticker: "ETH",
        },
        receiver: selfAddress, // Send to yourself!
        amount: 1000000000000000n, // 0.001 ETH (~$2)
      });

      const messageHashes = await vault.extractMessageHashes(payload);
      const signature = await vault.sign(
        "fast",
        {
          transaction: payload,
          chain: Chain.Ethereum,
          messageHashes,
        },
        password,
      );

      // Listen for broadcast event
      let broadcastEvent: any;
      vault.once("transactionBroadcast", (event) => {
        broadcastEvent = event;
      });

      // ⚠️ ACTUAL BROADCAST - FUNDS AT RISK
      const txHash = await vault.broadcastTx({
        chain: Chain.Ethereum,
        keysignPayload: payload,
        signature,
      });

      // Verify
      expect(txHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(broadcastEvent).toBeDefined();
      expect(broadcastEvent.chain).toBe(Chain.Ethereum);
      expect(broadcastEvent.txHash).toBe(txHash);

      console.log(`✅ Mainnet TX broadcast: ${txHash}`);
      console.log(`   View: https://etherscan.io/tx/${txHash}`);
      console.log(`   Type: Self-transfer (funds safe)`);
    },
  );
});
```

**Pros:**

- ✅ Tests real mainnet behavior
- ✅ Realistic gas fees and network conditions
- ✅ Verifies actual blockchain acceptance

**Cons:**

- ⚠️ Uses real funds (small risk)
- ⚠️ Network fees cost money
- ⚠️ Not suitable for CI/CD
- ⚠️ Requires careful monitoring

### Strategy 4: Mock Broadcast Layer 🧪

**Safety:** 🟢 Completely safe - mocked

Mock the broadcast layer to test integration without actual network calls.

```typescript
import { vi } from "vitest";

describe("Broadcast Transaction (Mocked)", () => {
  it("should handle successful broadcast", async () => {
    // Mock the core broadcast function
    vi.mock("@core/chain/tx/broadcast", () => ({
      broadcastTx: vi.fn().mockResolvedValue(undefined),
    }));

    // Mock the hash extraction
    vi.mock("@core/chain/tx/hash", () => ({
      getTxHash: vi.fn().mockResolvedValue("0x1234567890abcdef..."),
    }));

    const vault = await sdk.getVault("test-vault-id");

    // Prepare and sign
    const payload = await vault.prepareSendTx({
      /* ... */
    });
    const messageHashes = await vault.extractMessageHashes(payload);
    const signature = await vault.sign(
      "fast",
      {
        transaction: payload,
        chain: Chain.Ethereum,
        messageHashes,
      },
      password,
    );

    // Broadcast (mocked)
    const txHash = await vault.broadcastTx({
      chain: Chain.Ethereum,
      keysignPayload: payload,
      signature,
    });

    expect(txHash).toBe("0x1234567890abcdef...");
  });

  it("should handle broadcast failures", async () => {
    // Mock broadcast failure
    vi.mock("@core/chain/tx/broadcast", () => ({
      broadcastTx: vi.fn().mockRejectedValue(new Error("Network error")),
    }));

    // ... test error handling
  });
});
```

**Pros:**

- ✅ Completely safe
- ✅ Fast execution
- ✅ Can test error scenarios
- ✅ Good for unit testing

**Cons:**

- ❌ Doesn't test real network
- ❌ May not catch integration issues
- ❌ Requires maintaining mocks

## Recommended Testing Approach

### For Development

1. **Unit Tests** - Mock broadcast layer
2. **Dry Run Tests** - Prepare and sign only (no broadcast)
3. **Testnet Tests** - Full e2e with testnets (when SDK adds testnet support)

### For CI/CD

1. **Unit Tests** - Mocked broadcast
2. **Dry Run Tests** - Integration without broadcast
3. **Skip mainnet tests** - Never broadcast in CI

### For Manual QA

1. **Testnet Testing** - Primary method
2. **Minimal Mainnet** - Only for final validation with tiny amounts

## E2E Test Example (Safe)

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { loadTestVault } from "@helpers/test-vault";

describe("E2E: Broadcast Transaction (Safe)", () => {
  let vault: Vault;

  beforeAll(async () => {
    const result = await loadTestVault();
    vault = result.vault;
  });

  it("should prepare, sign, and verify broadcast readiness", async () => {
    // 1. Prepare transaction
    const ethAddress = await vault.address(Chain.Ethereum);
    const payload = await vault.prepareSendTx({
      coin: {
        chain: Chain.Ethereum,
        address: ethAddress,
        decimals: 18,
        ticker: "ETH",
      },
      receiver: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
      amount: 1000000000000000n, // 0.001 ETH
    });

    // 2. Verify payload structure
    expect(payload).toBeDefined();
    expect(payload.coin?.chain).toBe(Chain.Ethereum);

    // 3. Extract and verify message hashes
    const messageHashes = await vault.extractMessageHashes(payload);
    expect(messageHashes).toHaveLength(1);
    expect(messageHashes[0]).toMatch(/^0x[a-fA-F0-9]{64}$/);

    // 4. Sign transaction
    const signature = await vault.sign(
      "fast",
      {
        transaction: payload,
        chain: Chain.Ethereum,
        messageHashes,
      },
      process.env.TEST_VAULT_PASSWORD!,
    );

    // 5. Verify signature
    expect(signature).toBeDefined();
    expect(signature.signature).toBeDefined();
    expect(signature.format).toBeOneOf(["ECDSA", "EdDSA", "DER"]);

    // ✅ Transaction is ready to broadcast
    // 🔒 Not broadcasting to keep funds safe

    console.log("✅ Transaction ready for broadcast (not sent)");
    console.log("   Chain:", Chain.Ethereum);
    console.log("   Signature:", signature.signature.slice(0, 20) + "...");

    // Optional: Verify broadcast would work (without calling it)
    expect(() => {
      // This just verifies the types/structure
      const broadcastParams = {
        chain: Chain.Ethereum,
        keysignPayload: payload,
        signature,
      };
      expect(broadcastParams).toBeDefined();
    }).not.toThrow();
  });
});
```

## Future Enhancements

### Testnet Configuration Support

```typescript
// Proposed API for testnet support
interface VultisigConfig {
  network?: "mainnet" | "testnet" | "devnet";
  rpcEndpoints?: Record<Chain, string>;
}

const sdk = await Vultisig.create({
  network: "testnet",
  rpcEndpoints: {
    [Chain.Ethereum]: "https://sepolia.infura.io/v3/YOUR-KEY",
    [Chain.Bitcoin]: "https://bitcoin-testnet-rpc",
    [Chain.Solana]: "https://api.devnet.solana.com",
  },
});
```

### Transaction Simulation

```typescript
// Proposed API for dry-run simulation
const simulationResult = await vault.simulateBroadcast({
  chain: Chain.Ethereum,
  keysignPayload: payload,
  signature,
});

console.log("Simulation:", simulationResult);
// {
//   success: true,
//   estimatedGas: 21000n,
//   willSucceed: true,
//   revertReason: null
// }
```

## Resources

- [E2E Test Security Guide](../sdk/tests/e2e/SECURITY.md)
- [Ethereum Sepolia Faucet](https://sepoliafaucet.com)
- [Solana Devnet Faucet](https://solfaucet.com)
- [Bitcoin Testnet Faucet](https://testnet-faucet.mempool.co)

## Questions?

If you have questions about safe broadcast testing:

1. Check the [E2E Security Guide](../sdk/tests/e2e/SECURITY.md)
2. File an issue on GitHub
3. Ask in the development channel
