#!/usr/bin/env node

import { JsonRpcProvider } from "ethers";

import { VultisigSigner } from "../vultisig-eth-signer/dist/index.js";

async function testEthereumSigner() {
  console.log("🔐 Testing Vultisig Ethereum Signer...");

  try {
    // Create provider (using Sepolia testnet)
    const infuraUrl =
      process.env.INFURA_URL || "https://sepolia.infura.io/v3/YOUR_INFURA_KEY";
    const provider = new JsonRpcProvider(infuraUrl);

    // Create signer
    const signer = new VultisigSigner(provider);

    // Test getting address
    console.log("📍 Getting address...");
    const address = await signer.address();
    console.log(`✅ Address: ${address}`);

    // Test transaction signing (placeholder - won't actually send)
    console.log("✍️  Testing transaction signing...");
    const tx = {
      to: "0x8ba1f109551bD432803012645Hac136c0C4d9349",
      value: "1000000000000000", // 0.001 ETH
      gasLimit: "21000",
    };

    try {
      const signedTx = await signer.sign(tx);
      console.log(`✅ Signed transaction: ${signedTx.substring(0, 66)}...`);
    } catch (error) {
      console.log(
        `⚠️  Signing failed (expected if daemon not running): ${error.message}`,
      );
    }

    // Test typed data signing
    console.log("✍️  Testing EIP-712 typed data signing...");
    const domain = {
      name: "VultisigTest",
      version: "1",
      chainId: 11155111, // Sepolia
      verifyingContract: "0x8ba1f109551bD432803012645Hac136c0C4d9349",
    };

    const types = {
      Message: [{ name: "content", type: "string" }],
    };

    const value = {
      content: "Hello Vultisig!",
    };

    try {
      const signature = await signer.signTypedData(domain, types, value);
      console.log(`✅ Signed typed data: ${signature.substring(0, 66)}...`);
    } catch (error) {
      console.log(
        `⚠️  Typed data signing failed (expected if daemon not running): ${error.message}`,
      );
    }

    console.log("🎉 Ethereum signer test completed!");
  } catch (error) {
    console.error("❌ Test failed:", error.message);
    process.exit(1);
  }
}

testEthereumSigner();
