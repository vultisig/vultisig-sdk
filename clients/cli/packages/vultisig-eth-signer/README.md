# Vultisig Ethereum Signer

An ethers.js compatible signer that integrates with the Vultisig CLI daemon for MPC transaction signing.

## Installation

```bash
npm install vultisig-eth-signer ethers
```

## Usage

### Fast Signing (with VultiServer) - Default Mode

```typescript
import { VultisigSigner } from "vultisig-eth-signer";
import { JsonRpcProvider } from "ethers";

// Create signer (defaults to fast mode)
const provider = new JsonRpcProvider(
  "https://eth-mainnet.alchemyapi.io/v2/your-api-key",
);
const signer = new VultisigSigner(provider, {
  password: "your-vault-password",
});

// Get address
const address = await signer.getAddress();
console.log("Address:", address);

// Sign transaction
const tx = await signer.signTransaction({
  to: "0x742d35Cc6634C0532925a3b8D8C4f8de4c8e8e2f",
  value: "1000000000000000000", // 1 ETH
  gasLimit: "21000",
  gasPrice: "20000000000",
});
console.log("Signed transaction:", tx);
```

### Relay Signing (traditional MPC)

```typescript
import { VultisigSigner } from "vultisig-eth-signer";
import { JsonRpcProvider } from "ethers";

// Create a relay signer
const provider = new JsonRpcProvider(
  "https://eth-mainnet.alchemyapi.io/v2/your-api-key",
);
const signer = new VultisigSigner(provider, { mode: "relay" });

// Sign transaction using multi-party coordination
const tx = await signer.signTransaction({
  to: "0x742d35Cc6634C0532925a3b8D8C4f8de4c8e8e2f",
  value: "1000000000000000000",
  gasLimit: "21000",
  gasPrice: "20000000000",
});
```

### Custom Configuration

```typescript
import { VultisigSigner } from "vultisig-eth-signer";

const signer = new VultisigSigner(provider, {
  socketPath: "/custom/path/vultisig.sock",
  mode: "fast",
  password: "your-vault-password",
});

// Change signing mode dynamically
signer.setSigningMode("relay");
signer.setPassword("new-password");

console.log("Current mode:", signer.getSigningMode());
```

### ERC-20 Token Transfers

```typescript
import { Contract } from "ethers";

// USDC contract ABI (simplified)
const usdcAbi = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
];

// Create contract instance with Vultisig signer
const usdcContract = new Contract(
  "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC address
  usdcAbi,
  signer,
);

// Transfer 100 USDC (6 decimals)
const tx = await usdcContract.transfer(
  "0x742d35Cc6634C0532925a3b8D8C4f8de4c8e8e2f",
  "100000000", // 100 USDC
);

console.log("Transaction hash:", tx.hash);
await tx.wait();
console.log("Transfer confirmed!");
```

### Typed Data Signing (EIP-712)

```typescript
const domain = {
  name: "MyApp",
  version: "1",
  chainId: 1,
  verifyingContract: "0x...",
};

const types = {
  Transfer: [
    { name: "to", type: "address" },
    { name: "amount", type: "uint256" },
  ],
};

const value = {
  to: "0x742d35Cc6634C0532925a3b8D8C4f8de4c8e8e2f",
  amount: "1000000000000000000",
};

const signature = await signer.signTypedData(domain, types, value);
console.log("Typed data signature:", signature);
```

### Message Signing

```typescript
// Sign a simple message
const message = "Hello, Vultisig!";
const signature = await signer.signMessage(message);
console.log("Message signature:", signature);

// Sign binary data
const binaryData = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
const binarySignature = await signer.signMessage(binaryData);
console.log("Binary signature:", binarySignature);
```

## API Reference

### VultisigSigner

#### Constructor

```typescript
new VultisigSigner(provider?: Provider, config?: VultisigSignerConfig)
```

**Config defaults:**

- `mode: 'fast'` - Fast signing with VultiServer (default)
- `socketPath: '/tmp/vultisig.sock'` - Daemon socket path
- `password: undefined` - Required for fast mode

#### Instance Methods

- `getAddress(): Promise<string>` - Get wallet address
- `signTransaction(tx: TransactionRequest): Promise<string>` - Sign transaction
- `signMessage(message: string | Uint8Array): Promise<string>` - Sign message
- `signTypedData(domain, types, value): Promise<string>` - Sign EIP-712 data
- `getSigningMode(): 'fast' | 'relay' | 'local'` - Get current signing mode
- `setSigningMode(mode): void` - Set signing mode
- `setPassword(password: string): void` - Set password for fast signing

### Configuration Types

```typescript
type VultisigSignerConfig = {
  socketPath?: string; // Custom daemon socket path
  mode?: "fast" | "relay" | "local"; // Signing mode (default: 'fast')
  password?: string; // Password for fast signing
};
```

## Prerequisites

1. **Vultisig CLI Daemon**: Must be running with a vault loaded

   ```bash
   vultisig run --vault HotVault.vult --password your-password
   ```

2. **Fast Vault**: For fast signing, vault must have VultiServer participation

3. **Network Connection**: For fast/relay modes, internet connection required

## Error Handling

```typescript
try {
  const signature = await signer.signTransaction(tx);
  console.log("Success:", signature);
} catch (error) {
  if (error.message.includes("daemon")) {
    console.error("Daemon not running. Start with: vultisig run");
  } else if (error.message.includes("password")) {
    console.error("Invalid password for fast signing");
  } else {
    console.error("Signing failed:", error.message);
  }
}
```

## Integration with Popular DApps

### Uniswap V3 Integration

```typescript
import { VultisigSigner } from 'vultisig-eth-signer'
import { ethers } from 'ethers'

const provider = new ethers.JsonRpcProvider('https://mainnet.infura.io/v3/your-key')
const signer = VultisigSigner.createFastSigner(process.env.VAULT_PASSWORD, provider)

// Use with Uniswap SDK or direct contract calls
const uniswapRouter = new ethers.Contract(routerAddress, routerAbi, signer)
const swapTx = await uniswapRouter.swapExactTokensForTokens(...)
```

### MetaMask Alternative

```typescript
// Drop-in replacement for MetaMask in DApp integrations
const vultisigSigner = VultisigSigner.createFastSigner(password, provider);

// Use anywhere you would use MetaMask signer
const contract = new Contract(address, abi, vultisigSigner);
const result = await contract.someMethod();
```

## Security Notes

- **Password Security**: Store vault passwords securely (environment variables, secure vaults)
- **Socket Security**: Default socket path `/tmp/vultisig.sock` has appropriate permissions
- **Fast Mode**: Requires VultiServer connectivity for server-assisted signing
- **Relay Mode**: Uses traditional MPC with multiple device coordination

## Troubleshooting

### Common Issues

1. **"Socket error: ENOENT"**
   - Solution: Start Vultisig daemon with `vultisig run`

2. **"Failed to sign transaction: No active vault"**
   - Solution: Load a vault in the daemon

3. **"Fast signing requires password"**
   - Solution: Provide password when creating fast signer

4. **"Vault does not have VultiServer"**
   - Solution: Use relay mode or create a fast vault
