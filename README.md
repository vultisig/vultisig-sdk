# Vultisig SDK

The self-custodial multi-chain wallet SDK for AI agents and developers.

- **Send & swap** across 40+ blockchains with human-readable amounts (`vault.send({ amount: "0.1" })`)
- **MPC security** — keys are split across parties, no seed phrases, no single point of failure
- **Built-in cross-chain swaps** via THORChain, 1inch, KyberSwap, and LiFi — automatic routing
- **Portfolio tracking** with real-time balances and fiat prices
- **Dry-run mode** for sends and swaps — preview fees and output before signing
- **AI agent ready** — JSON output, programmatic API, designed for autonomous operation

## Overview

Vultisig SDK enables developers and AI agents to integrate multi-chain wallet functionality into their applications. The SDK supports two vault types:

- **Fast Vault**: Server-assisted 2-of-2 MPC for quick setup and instant signing
- **Secure Vault**: Multi-device N-of-M MPC for enhanced security with configurable thresholds

Both vault types provide comprehensive blockchain support including Bitcoin, Ethereum, Cosmos, Solana, and 40+ others.

## Features

- **Fast Vault**: Server-assisted MPC with VultiServer for instant signing (2-of-2 standard, 2-of-3 from seedphrase import)
- **Secure Vault**: Multi-device N-of-M threshold signing with mobile device pairing
- **QR Code Pairing**: Pair with Vultisig mobile apps for secure vault operations
- **Address Derivation**: Generate blockchain addresses using WalletCore WASM
- **Vault Management**: Create, import, export, and manage encrypted vaults
- **Cross-Chain Support**: Bitcoin, Ethereum, Cosmos, Solana, and 40+ blockchains
- **Token Registry**: Built-in known token database, fee coin lookup, and on-chain token discovery
- **Security Scanning**: Transaction validation and simulation via Blockaid, site phishing detection
- **Price Feeds**: Fetch token prices via CoinGecko
- **Fiat On-Ramp**: Generate Banxa buy URLs for 23+ chains
- **Compound Wrappers**: `send()`, `swap()`, `signMessage()`, `portfolio()`, `allBalances()` — single-call operations with human-readable amounts (`send`/`swap` support dryRun)
- **TypeScript**: Full type safety and IntelliSense support

## Installation

```bash
npm install @vultisig/sdk
# or
yarn add @vultisig/sdk
```

### Related packages

- `@vultisig/rujira` — Rujira (FIN) swaps + secured asset deposit/withdraw helpers on THORChain

## Quick Start

### Fast Vault (Server-Assisted)

```typescript
import { Vultisig, Chain } from '@vultisig/sdk'

// Initialize SDK (storage is auto-configured for your platform)
const sdk = new Vultisig()
await sdk.initialize()

// Create a fast vault (server-assisted 2-of-2)
const vaultId = await sdk.createFastVault({
  name: "My Wallet",
  email: "user@example.com",
  password: "secure-password",
});

// Verify with email code
const vault = await sdk.verifyVault(vaultId, "1234");

// Derive addresses
const btcAddress = await vault.address(Chain.Bitcoin);
const ethAddress = await vault.address(Chain.Ethereum);

// Send tokens (human-readable amounts)
const result = await vault.send({ chain: Chain.Ethereum, to: "0x...", amount: "0.1" });

// Sign messages (EIP-191 for EVM, SHA-256 for others)
const { signature } = await vault.signMessage("Login to MyDapp");

// Swap tokens
await vault.swap({ fromChain: Chain.Ethereum, fromSymbol: "ETH", toChain: Chain.Bitcoin, toSymbol: "BTC", amount: "0.5" });

// Portfolio overview
const portfolio = await vault.portfolio("usd");
```

### Secure Vault (Multi-Device)

```typescript
// Create a secure vault (2-of-3 threshold)
const { vault } = await sdk.createSecureVault({
  name: "Team Wallet",
  devices: 3,
  onQRCodeReady: (qrPayload) => {
    // Display QR code for other devices to scan
    displayQRCode(qrPayload);
  },
  onDeviceJoined: (deviceId, total, required) => {
    console.log(`Device joined: ${total}/${required}`);
  }
});

// Sign transactions (requires device coordination)
await vault.sign(payload, {
  onQRCodeReady: (qr) => displayQRCode(qr),
  onDeviceJoined: (id, total, required) => {
    console.log(`Signing: ${total}/${required} devices ready`);
  }
});
```

> **WARNING — Storage & Vault Backups:** The SDK auto-configures persistent storage for your platform (FileStorage on Node.js, BrowserStorage in browsers). Do **not** use `MemoryStorage` in production — it is non-persistent and all vault keyshares are lost when the process exits. Loss of keyshares means **permanent loss of funds**. Always back up your vaults using `vault.export()`.

## Documentation

- [SDK API Reference & Examples](packages/sdk/README.md) — Full API docs with code examples
- [SDK Users Guide](docs/SDK-USERS-GUIDE.md) — Detailed usage guide with advanced topics
- [CLI Documentation](clients/cli/README.md) — Command-line interface
- [docs.vultisig.com](https://docs.vultisig.com/developer-docs/vultisig-sdk/) — Online documentation

## Type Reference

All compound methods live on `VaultBase` (inherited by `FastVault` and `SecureVault`).

### Balance

```typescript
type Balance = {
  amount: string           // Raw amount in base units (as string)
  formattedAmount: string  // Human-readable (e.g., "1.5")
  decimals: number         // Token decimal places
  symbol: string           // Token symbol (e.g., "ETH", "BTC")
  chainId: string          // Chain identifier
  tokenId?: string         // Token contract address (if not native coin)
  value?: number           // Price per unit in fiat (populated by portfolio)
  fiatValue?: number       // Total fiat value (populated by portfolio)
  fiatCurrency?: string    // Fiat currency code (e.g., "USD")
}
```

### Portfolio

```typescript
await vault.portfolio("usd")

type Portfolio = {
  balances: Balance[]   // Balances with fiat values populated
  totalValue: string    // Total portfolio value (human-readable, e.g., "1234.56")
  currency: string      // Fiat currency used (e.g., "usd")
}
```

### Send

```typescript
// Execute
const result = await vault.send({ chain: Chain.Ethereum, to: "0x...", amount: "0.1" })
// result.txHash -> "0xabc..."

// Dry run (estimate fees without signing)
const preview = await vault.send({ chain: Chain.Ethereum, to: "0x...", amount: "0.1", dryRun: true })
// preview.fee -> "0.00042"
// preview.total -> "0.10042"

type SendResult =
  | { dryRun: false; txHash: string; chain: Chain }
  | { dryRun: true; fee: string; total: string; keysignPayload: KeysignPayload }
```

**Full send params:** `{ chain, to, amount, symbol?, memo?, dryRun? }`
- Omit `symbol` for native token (ETH, BTC). Set it for ERC-20s (e.g., `"USDC"`).

### Swap

```typescript
// Dry run (get quote)
const quote = await vault.swap({
  fromChain: Chain.Ethereum, fromSymbol: "ETH",
  toChain: Chain.Ethereum, toSymbol: "USDC",
  amount: "0.5", dryRun: true
})
// quote.quote.provider -> "1inch"
// quote.quote.estimatedOutput -> bigint (base units)
// quote.quote.fees -> fee breakdown

// Execute
const result = await vault.swap({
  fromChain: Chain.Ethereum, fromSymbol: "ETH",
  toChain: Chain.Bitcoin, toSymbol: "BTC",
  amount: "0.5"
})
// result.txHash -> "0xabc..."

type CompoundSwapResult =
  | { dryRun: false; txHash: string; chain: Chain; quote: SwapQuoteResult }
  | { dryRun: true; quote: SwapQuoteResult }

type SwapQuoteResult = {
  quote: SwapQuote               // Raw quote from provider
  estimatedOutput: bigint        // Output amount in base units
  estimatedOutputFiat?: number   // Output in fiat
  provider: string               // "thorchain", "1inch", "kyber", "li.fi", "maya"
  expiresAt: number              // Quote expiry (ms)
  requiresApproval: boolean      // ERC-20 approval needed?
  approvalInfo?: SwapApprovalInfo // Approval details (when required)
  fees: SwapFees                 // Fee breakdown (base units)
  feesFiat?: SwapFeesFiat        // Fee breakdown in fiat
  warnings: string[]             // Provider warnings
  fromCoin: ResolvedCoinInfo     // Source coin details
  toCoin: ResolvedCoinInfo       // Destination coin details
  balance: bigint                // Source balance (base units)
  maxSwapable: bigint            // Max swappable (base units)
}
```

### Sign Message

```typescript
const { signature, chain, algorithm } = await vault.signMessage("Hello World")

type MessageSignature = {
  signature: string        // Hex-encoded (e.g., "0x..." for EVM)
  chain: Chain             // Chain used for signing
  algorithm: 'ECDSA' | 'EdDSA'
}
```

### Vault Loading

```typescript
// List all vaults
const vaults: VaultBase[] = await sdk.listVaults()

// Find by name (listVaults + filter)
const vault = vaults.find(v => v.name === 'MyVault')

// By ID
const vault: VaultBase | null = await sdk.getVaultById("vault-id")

// Active vault
const vault: VaultBase | null = await sdk.getActiveVault()
```

### Which Balance Method to Use

| Need | Method | Returns |
|------|--------|---------|
| One chain, native coin | `vault.balance(chain)` | `Balance` |
| One chain, specific token | `vault.balance(chain, tokenId)` | `Balance` |
| Multiple specific chains | `vault.balances(chains, includeTokens?)` | `Record<string, Balance>` |
| All configured chains | `vault.allBalances(includeTokens?)` | `Balance[]` |
| Full portfolio with fiat | `vault.portfolio("usd")` | `Portfolio` |

## Security

- **No Private Keys**: Private keys never exist in complete form
- **MPC Security**: Keys are split across multiple parties using threshold signatures
- **Configurable Thresholds**: Secure vaults support N-of-M signing (e.g., 2-of-3, 3-of-5)
- **Encryption**: All vault data is encrypted with user passwords
- **WASM Isolation**: Cryptographic operations run in WebAssembly sandbox

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, project structure, and contribution guidelines.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

- **Documentation**: [docs.vultisig.com](https://docs.vultisig.com)
- **Issues**: [GitHub Issues](https://github.com/vultisig/vultisig-sdk/issues)
- **Community**: [Discord](https://discord.gg/vultisig)

---

Built with ❤️ by the Vultisig Team
